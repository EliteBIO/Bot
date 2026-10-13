import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const phone = process.env.PHONE_NUMBER;

let reconnecting = false;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      reconnecting = false;
      console.log('WhatsApp bot connected.');
    }

    if (connection === 'close' && !reconnecting) {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        reconnecting = true;
        setTimeout(() => {
          startBot().catch(err => console.error('Reconnect error:', err));
        }, 3000);
      } else {
        console.log('WhatsApp logged out. Remove old auth_info and pair again.');
      }
    }
  });

  if (!state.creds.registered) {
    if (!phone) {
      console.log('Set PHONE_NUMBER before starting the bot.');
      return;
    }
    const code = await sock.requestPairingCode(phone.replace(/\D/g, ''));
    console.log('WhatsApp pairing code:', code);
    console.log('Enter this code in WhatsApp > Linked devices > Link a device.');
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us')) continue;

      const text = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        ''
      ).trim().toLowerCase();

      let reply;

      if (['hi', 'hello', 'hey', 'menu', 'start'].includes(text)) {
        reply = `Welcome to our SMM service!

Reply with a number:
1 - New Order
2 - Add Funds
3 - Track Order
4 - Customer Support

Type MENU anytime to see these options again.`;
      } else if (text === '1') {
        reply = 'NEW ORDER\nPlease send the service name, public link, and quantity. We will confirm availability before processing.';
      } else if (text === '2') {
        reply = 'ADD FUNDS\nTell us the amount you want to deposit. Contact support for current payment instructions. Never share your UPI PIN, OTP, or password.';
      } else if (text === '3') {
        reply = 'ORDER TRACKING\nPlease send your order ID. This starter bot cannot fetch live SMM panel status automatically; a team member must check it.';
      } else if (text === '4') {
        reply = 'CUSTOMER SUPPORT\nDescribe your issue and include your order ID if applicable. Never send passwords or verification codes.';
      } else {
        reply = 'Sorry, I did not understand that. Type MENU to see the options.';
      }

      try {
        await sock.sendMessage(jid, { text: reply });
      } catch (err) {
        console.error('Reply failed:', err?.message || err);
      }
    }
  });
}

startBot().catch(err => console.error('Bot failed to start:', err));
