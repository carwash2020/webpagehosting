// Client portal push notification subscription (2026-09-04),
// requested directly: "lets build push notifications."
//
// Adapted from /tools/push-notifications.js's own proven pattern --
// same underlying Push API and subscribe/unsubscribe flow -- but
// using the Supabase JS SDK's own client.auth.getSession() for the
// access token and user id, rather than auth.js's getAuthToken()/
// getCurrentUserId(). The portal deliberately never loads auth.js at
// all (see docs/CLIENT-PORTAL.md's "Hard architectural boundary with
// /tools/" -- that file is built entirely around the internal team's
// own login and roles, none of which belongs on a page an external
// client can reach), so this needed its own copy rather than reusing
// that one.
//
// Every function here expects `client` (the page's own Supabase SDK
// instance, already created before this file's functions are ever
// called) and `SUPABASE_URL`/`SUPABASE_ANON_KEY` to already exist as
// page-level globals -- exactly the same constants every portal page
// already declares for its own REST calls.

const PORTAL_VAPID_PUBLIC_KEY = 'BBzuN00_0yLPLKlECPo0PFNCoFd_3z6tP7EGAOMNXOw7HVUr3woUJqYuLzz8fMe17v2XB3yemhwNuWN6Z0c9W2M';

function portalUrlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function portalPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function getExistingPortalPushSubscription() {
  if (!portalPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

async function isPortalPushEnabled() {
  const sub = await getExistingPortalPushSubscription();
  return !!sub;
}

async function enablePortalPushNotifications() {
  if (!portalPushSupported()) {
    return { ok: false, error: "Push notifications aren't supported in this browser." };
  }
  if (Notification.permission === 'denied') {
    return { ok: false, error: 'Notifications are blocked for this site -- check your browser/device settings to allow them, then try again.' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, error: "Permission wasn't granted." };
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription;
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: portalUrlBase64ToUint8Array(PORTAL_VAPID_PUBLIC_KEY),
    });
  } catch (e) {
    return { ok: false, error: "Couldn't set up notifications on this device: " + e.message };
  }

  const { data: { session } } = await client.auth.getSession();
  if (!session) return { ok: false, error: 'Not signed in.' };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${session.access_token}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ user_id: session.user.id, subscription: subscription.toJSON() }),
    });
    if (!res.ok) return { ok: false, error: 'Saved on this device, but failed to register with the server (http-' + res.status + ').' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Network error while saving the subscription.' };
  }
}

async function disablePortalPushNotifications() {
  const subscription = await getExistingPortalPushSubscription();
  if (!subscription) return { ok: true };

  const endpoint = subscription.endpoint;
  try { await subscription.unsubscribe(); } catch (e) { /* continue anyway */ }

  try {
    const { data: { session } } = await client.auth.getSession();
    if (session) {
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?subscription->>endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
        },
      });
    }
  } catch (e) { /* the local unsubscribe already succeeded either way */ }

  return { ok: true };
}
