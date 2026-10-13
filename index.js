
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys';

import pino from 'pino';

const PHONE_NUMBER = (process.env.PHONE_NUMBER || '').replace(/\D/g, '');
const logger = pino({ level: 'silent' });

let reconnectTimer;

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState('./auth_info');

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: ['SMM Helper Bot', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  let pairingRequested = false;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Request the pairing code only after the QR event.
    if (qr && !state.creds.registered && !pairingRequested) {
      pairingRequested = true;

      try {
        if (!PHONE_NUMBER || PHONE_NUMBER.length < 11) {
          console.log('Set PHONE_NUMBER in international format.');
          return;
        }

        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log('\nWhatsApp pairing code:', code);
        console.log(
          'On your phone: WhatsApp > Linked devices > Link a device > Link with phone number instead'
        );
        console.log('Enter the code. Do not share it with anyone.\n');
      } catch (error) {
        console.error('Pairing failed:', error?.message || error);
      }
    }

    if (connection === 'open') {
      console.log('WhatsApp connected! Bot is ready.');
    }

    if (connection === 'close') {
      const status =
        lastDisconnect?.error?.output?.statusCode;

      console.log('Connection closed. Status:', status ?? 'unknown');

      if (status === DisconnectReason.loggedOut) {
        console.log('WhatsApp logged out. Pair again if needed.');
        return;
      }

      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        startBot().catch(console.error);
      }, 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      if (
        !jid ||
        jid === 'status@broadcast' ||
        jid.endsWith('@g.us')
      ) continue;

      const text = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        ''
      ).trim().toLowerCase();

      let reply;

      if (['hi', 'hello', 'hey', 'menu', 'start'].includes(text)) {
        reply = `WELCOME TO OUR SMM SERVICE

1 - New Order
2 - Add Funds
3 - Track Order
4 - Customer Support

Reply with a number.
Type MENU to see the menu again.`;
      } else if (text === '1') {
        reply = `NEW ORDER

Please send the service name, public post/profile link, and quantity.
We will confirm availability before processing.
Never share your account password.`;
      } else if (text === '2') {
        reply = `ADD FUNDS

Tell us the amount you want to deposit.
Contact support for current payment instructions.
Never share your UPI PIN, OTP, or password.`;
      } else if (text === '3') {
        reply = `TRACK ORDER

Please send your order ID.
Live status must be checked in your SMM panel; this starter bot does not fetch it automatically.`;
      } else if (text === '4') {
        reply = `CUSTOMER SUPPORT

Describe your issue and include your order ID if available.
Never share passwords or verification codes.`;
      } else {
        reply = 'Sorry, I did not understand. Type MENU to see the options.';
      }

      try {
        await sock.sendMessage(jid, { text: reply });
      } catch (error) {
        console.error('Reply failed:', error?.message || error);
      }
    }
  });
}

startBot().catch((error) => {
  console.error('Bot failed to start:', error?.message || error);
});
          
