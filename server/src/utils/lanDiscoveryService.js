const dgram = require('dgram');
const os = require('os');
const { getPublicDeviceProfile } = require('./deviceCrypto');

const DISCOVERY_PORT = parseInt(process.env.LAN_DISCOVERY_PORT || '5001', 10);
let serverSocket = null;

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

/**
 * Start background UDP Discovery Listener Socket on 0.0.0.0:5001
 */
function startLanDiscoveryService() {
  if (serverSocket) return;

  try {
    serverSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    serverSocket.on('message', (msg, rinfo) => {
      try {
        const localIps = getLocalIpAddresses();
        const payload = JSON.parse(msg.toString());
        const profile = getPublicDeviceProfile();
        // Ignore self-broadcasts by deviceId
        if (payload && payload.senderDeviceId === profile.deviceId) return;

        if (payload && payload.type === 'SYNCNOTE_DISCOVER_PROBE') {
          const responsePayload = JSON.stringify({
            type: 'SYNCNOTE_DISCOVER_RESPONSE',
            deviceId: profile.deviceId,
            deviceName: profile.deviceName,
            deviceType: profile.deviceType || 'desktop',
            publicKey: profile.publicKey,
            protocolVersion: '1.0.0',
            syncnoteVersion: '1.0.0',
            port: parseInt(process.env.PORT || '5000', 10),
            ip: rinfo.address,
            ipAddresses: localIps,
            lanSyncAvailable: true,
            userId: payload.userId || 'usr_local_default'
          });

          const replySocket = dgram.createSocket('udp4');
          replySocket.send(Buffer.from(responsePayload), rinfo.port, rinfo.address, (err) => {
            try { replySocket.close(); } catch (e) {}
          });
        }
      } catch (err) {
        // Ignore invalid UDP packets
      }
    });

    serverSocket.on('error', (err) => {
      console.warn('[LAN UDP Discovery Listener Warning]:', err.message);
      try { serverSocket.close(); } catch (e) {}
      serverSocket = null;
    });

    serverSocket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      try {
        serverSocket.setBroadcast(true);
        console.log(`[LAN Discovery Service] UDP broadcast listener active on 0.0.0.0:${DISCOVERY_PORT}`);
      } catch (e) {}
    });
  } catch (err) {
    console.warn('[LAN Discovery Service Initialization Warning]:', err.message);
  }
}

/**
 * Trigger active UDP broadcast probe on LAN subnets and gather responses
 */
function discoverDevicesUDP(timeoutMs = 1200) {
  return new Promise((resolve) => {
    const discoveredMap = new Map();
    const localIps = getLocalIpAddresses();
    const profile = getPublicDeviceProfile();

    let clientSocket = null;
    try {
      clientSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch (e) {
      return resolve([]);
    }

    clientSocket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        // Ignore self-broadcasts by deviceId
        if (data && data.type === 'SYNCNOTE_DISCOVER_RESPONSE' && data.deviceId && data.deviceId !== profile.deviceId) {
          discoveredMap.set(data.deviceId, {
            deviceId: data.deviceId,
            deviceName: data.deviceName,
            deviceType: data.deviceType || 'desktop',
            publicKey: data.publicKey,
            protocolVersion: data.protocolVersion || '1.0.0',
            syncnoteVersion: data.syncnoteVersion || '1.0.0',
            port: data.port || 5000,
            ip: rinfo.address,
            ipAddresses: data.ipAddresses || [rinfo.address],
            lanSyncAvailable: true,
            userId: data.userId || 'usr_local_default'
          });
        }
      } catch (e) {}
    });

    clientSocket.on('error', () => {});

    clientSocket.bind(0, '0.0.0.0', () => {
      try {
        clientSocket.setBroadcast(true);
        const probePayload = Buffer.from(JSON.stringify({
          type: 'SYNCNOTE_DISCOVER_PROBE',
          senderDeviceId: profile.deviceId,
          senderDeviceName: profile.deviceName
        }));

        // Send to standard global broadcast address
        clientSocket.send(probePayload, DISCOVERY_PORT, '255.255.255.255', () => {});

        // Send to targeted local subnet broadcast addresses
        for (const ip of localIps) {
          const subnetPrefix = ip.substring(0, ip.lastIndexOf('.'));
          const subnetBroadcast = `${subnetPrefix}.255`;
          clientSocket.send(probePayload, DISCOVERY_PORT, subnetBroadcast, () => {});
        }
      } catch (e) {}
    });

    setTimeout(() => {
      try { clientSocket.close(); } catch (e) {}
      resolve(Array.from(discoveredMap.values()));
    }, timeoutMs);
  });
}

module.exports = {
  startLanDiscoveryService,
  discoverDevicesUDP
};
