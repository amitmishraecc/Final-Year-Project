function canNotify() {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestNotificationPermissionOnce(promptKey = "web_notify_prompted") {
  if (!canNotify()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  if (localStorage.getItem(promptKey)) return Notification.permission;
  localStorage.setItem(promptKey, "1");
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function notifyNewItems({
  items = [],
  storageKey,
  title = "New Notification",
  getBody = (item) => item?.title || "You have a new update.",
  maxPopups = 3,
}) {
  if (!storageKey) return;
  const ids = items.map((i) => i?.id).filter(Boolean);
  if (!ids.length) return;

  const previousRaw = localStorage.getItem(storageKey);
  if (!previousRaw) {
    localStorage.setItem(storageKey, JSON.stringify(ids.slice(0, 300)));
    return;
  }

  let previousIds = [];
  try {
    previousIds = JSON.parse(previousRaw);
  } catch {
    previousIds = [];
  }
  const prevSet = new Set(previousIds);
  const newItems = items.filter((item) => item?.id && !prevSet.has(item.id));

  if (canNotify() && Notification.permission === "granted") {
    newItems.slice(0, maxPopups).forEach((item) => {
      try {
        new Notification(title, { body: getBody(item) });
      } catch {
        // ignore notification failure
      }
    });
  }

  localStorage.setItem(storageKey, JSON.stringify(ids.slice(0, 300)));
}
