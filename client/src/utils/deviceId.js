/**
 * Device Identity Utility
 * Manages persistent device ID and name for multi-device sync preparation
 */

export function getDeviceId() {
  let deviceId = localStorage.getItem('syncnote_device_id');
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    localStorage.setItem('syncnote_device_id', deviceId);
  }
  return deviceId;
}

export function getDeviceName() {
  let deviceName = localStorage.getItem('syncnote_device_name');
  if (deviceName) return deviceName;

  const userAgent = navigator.userAgent;
  let os = 'Desktop PC';

  if (userAgent.indexOf('Win') !== -1) os = 'Windows PC';
  else if (userAgent.indexOf('Mac') !== -1) os = 'Macintosh';
  else if (userAgent.indexOf('Linux') !== -1) os = 'Linux Workstation';
  else if (userAgent.indexOf('Android') !== -1) os = 'Android Device';
  else if (userAgent.indexOf('like Mac') !== -1) os = 'iOS Device';

  return os;
}

export function getDeviceType() {
  const ua = navigator.userAgent;
  if (/mobile/i.test(ua)) return 'mobile';
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  return 'desktop';
}

export function setDeviceName(name) {
  if (name && name.trim()) {
    localStorage.setItem('syncnote_device_name', name.trim());
  }
}
