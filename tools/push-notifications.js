// ============================================================
// Triple H Workspace — Push Notification subscription
// ============================================================
// Handles the client side only: asking permission, subscribing through
// the browser's Push API, and saving the resulting subscription to
// Supabase. Actually SENDING a notification happens entirely server
// side (a Supabase Edge Function) -- nothing in this file sends
// anything, it only sets up where things should be sent TO.
//
// Real platform limitation worth knowing, not a bug in this code: on
// iPhone/iPad, this only works at all if the site has already been
// added to the Home Screen. Opened in a normal Safari tab, requesting
// permission will just silently fail to produce a working subscription
// -- that's an Apple restriction, not something fixable here.

const VAPID_PUBLIC_KEY = 'BBzuN00_0yLPLKlECPo0PFNCoFd_3z6tP7EGAOMNXOw7HVUr3woUJqYuLzz8fMe17v2XB3yemhwNuWN6Z0c9W2M';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function pushNotificationsSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// getRegistration(), not .ready (2026-09-30): .ready never settles when no
// worker ever registers (a failed registration, workers switched off), and
// everything awaiting this -- Settings' startup, and the two-factor card
// after it -- hung on "Loading...". No registration means no subscription.
async function getExistingPushSubscription() {
  if (!pushNotificationsSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

async function isPushEnabled() {
  const sub = await getExistingPushSubscription();
  return !!sub;
}

async function enablePushNotifications() {
  if (!pushNotificationsSupported()) {
    return { ok: false, error: 'Push notifications aren\'t supported in this browser.' };
  }
  if (Notification.permission === 'denied') {
    return { ok: false, error: 'Notifications are blocked for this site -- check your browser/OS settings to allow them, then try again.' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, error: 'Permission wasn\'t granted.' };
  }

  // Subscribing does need an active worker, so this waits for one -- but
  // not forever (same never-settling .ready as above).
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
  ]);
  if (!registration) {
    return { ok: false, error: 'This page\'s background helper hasn\'t started, so notifications can\'t be set up yet. Reload the page and try again.' };
  }
  let subscription;
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  } catch (e) {
    return { ok: false, error: 'Couldn\'t set up notifications on this device: ' + e.message };
  }

  const userId = getCurrentUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  try {
    const subJson = subscription.toJSON();
    // Found during a direct scale audit (2026-09-05): a plain INSERT
    // here let a client toggle push off and back on repeatedly on the
    // same device, each time inserting a fresh row for the same real
    // endpoint -- genuinely duplicate notifications on every future
    // send, not just a wasted row. A real upsert (matched against the
    // new unique index on (user_id, endpoint)) replaces the old row
    // for this device instead of accumulating another one.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=user_id,endpoint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
        'Prefer': 'return=minimal,resolution=merge-duplicates',
      },
      body: JSON.stringify({ user_id: userId, endpoint: subJson.endpoint, subscription: subJson }),
    });
    if (!res.ok) return { ok: false, error: 'Saved on this device, but failed to register with the server (http-' + res.status + ').' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Network error while saving the subscription.' };
  }
}

async function disablePushNotifications() {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return { ok: true };

  const endpoint = subscription.endpoint;
  try { await subscription.unsubscribe(); } catch (e) { /* continue anyway */ }

  try {
    // Filters on the real endpoint column now, matching the index
    // that actually backs it -- the old subscription->>endpoint
    // JSONB filter has no supporting index anymore (superseded by
    // the plain column added in this same audit).
    await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${getAuthToken()}`,
      },
    });
  } catch (e) { /* the local unsubscribe already succeeded either way */ }

  return { ok: true };
}
