import { realDb, db } from "../lib/firebase";
import { ref, push, onValue, update } from "firebase/database";
import { collection, getDocs } from "firebase/firestore";

/**
 * Sends a notification to all registered users.
 */
export async function sendNotificationToAll(title, message) {
  try {
    // 1. Fetch all users from Firestore
    const usersSnap = await getDocs(collection(db, "users"));
    
    // 2. Loop through each user and push to their RTDB node
    usersSnap.forEach((userDoc) => {
      const uid = userDoc.id;
      const notifRef = ref(realDb, `notifications/${uid}`);
      push(notifRef, {
        title,
        message,
        date: new Date().toISOString(),
        read: false
      });
    });

    return { success: true };
  } catch (error) {
    console.error("Error sending notifications:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Subscribes to a user's notifications.
 */
export function subscribeToNotifications(uid, callback) {
  if (!uid) return () => {};
  
  const notifRef = ref(realDb, `notifications/${uid}`);
  const unsubscribe = onValue(notifRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      const arr = Object.keys(data).map(key => ({ id: key, ...data[key] }));
      // Sort newest first
      arr.sort((a, b) => new Date(b.date) - new Date(a.date));
      callback(arr);
    } else {
      callback([]);
    }
  });
  
  return unsubscribe;
}

/**
 * Marks a notification as read.
 */
export async function markNotificationAsRead(uid, notificationId) {
  try {
    const notifRef = ref(realDb, `notifications/${uid}/${notificationId}`);
    await update(notifRef, { read: true });
  } catch (error) {
    console.error("Failed to mark notification as read:", error);
  }
}
