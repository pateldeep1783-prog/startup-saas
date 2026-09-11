import localtunnel from 'localtunnel';

const SUBDOMAIN = 'deepclinic-inbound-webhook';
const PORT = 3001;

async function startTunnel() {
  try {
    const tunnel = await localtunnel({ port: PORT, subdomain: SUBDOMAIN });
    console.log(`====================================================`);
    console.log(`🚀 PERMANENT TUNNEL ACTIVE AT: ${tunnel.url}`);
    console.log(`📩 WEBHOOK URL FOR SENDGRID: ${tunnel.url}/api/webhook/email`);
    console.log(`====================================================`);

    tunnel.on('close', () => {
      console.warn('⚠️ Tunnel closed, reconnecting in 3 seconds...');
      setTimeout(startTunnel, 3000);
    });

    tunnel.on('error', (err) => {
      console.error('⚠️ Tunnel error:', err.message);
      setTimeout(startTunnel, 5000);
    });
  } catch (err) {
    console.error('⚠️ Failed to start tunnel:', err.message, 'Retrying in 5s...');
    setTimeout(startTunnel, 5000);
  }
}

startTunnel();
