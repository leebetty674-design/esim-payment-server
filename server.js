const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let orders = [];

function generateOrderId() {
  return 'ESIM-' + Date.now().toString(36).toUpperCase();
}

function krwToUsdt(krwAmount) {
  return (krwAmount / 1350).toFixed(2);
}

const transporter = nodemailer.createTransport({
  host: 'smtp.naver.com',
  port: 465,
  secure: true,
  auth: {
    user: 'das3144@naver.com',
    pass: 'ZXTRD9P5XHCP',
  },
});

async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({
      from: '"eSIM Global" <das3144@naver.com>',
      to, subject, html,
    });
    return true;
  } catch (error) {
    console.error('Email error:', error);
    return false;
  }
}

async function verifyUsdtPayment(txHash, expectedAmount) {
  try {
    const url = `https://tonapi.io/v2/blockchain/transactions/${txHash}`;
    const response = await axios.get(url, {
      headers: { 'Authorization': 'Bearer AF5E37GZRS6XSKYAAAACZRQLNSW5TKL2LDNTVFX4W7L6GBZTRUP4AVZQTWGVTSKR5RAA3VY' }
    });
    
    const tx = response.data;
    if (tx.jetton_transfers && tx.jetton_transfers.length > 0) {
      const jettonTransfer = tx.jetton_transfers[0];
      const jettonAddress = jettonTransfer.jetton?.address;
      const isUsdt = jettonAddress === 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7L2g7MdB9Y';
      const recipient = jettonTransfer.destination?.address;
      const isCorrectRecipient = recipient === 'UQA51y59urbfZX33AMAhwCs2mEtI6hgTO2_1mXIp_hop-VEe';
      const actualAmount = (parseInt(jettonTransfer.amount) / 1000000).toFixed(2);
      const amountMatches = Math.abs(parseFloat(expectedAmount) - parseFloat(actualAmount)) < 0.01;
      
      if (isUsdt && isCorrectRecipient && amountMatches) {
        return { verified: true, transaction: { hash: txHash, amount: actualAmount } };
      }
      return { verified: false, error: 'Verification failed' };
    }
    return { verified: false, error: 'No USDT transfer found' };
  } catch (error) {
    return { verified: false, error: error.message };
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', usdtAddress: 'UQA51y59urbfZX33AMAhwCs2mEtI6hgTO2_1mXIp_hop-VEe' });
});

app.post('/api/orders', async (req, res) => {
  try {
    const { email, firstName, lastName, phone, items, totalKrw } = req.body;
    const orderId = generateOrderId();
    const usdtAmount = krwToUsdt(totalKrw);
    
    const order = {
      orderId, email, firstName, lastName, phone: phone || '',
      items, totalKrw, usdtAmount,
      status: 'pending_payment',
      txHash: null,
      createdAt: new Date().toISOString()
    };
    
    orders.push(order);
    
    await sendEmail(email, `Order Confirmation - ${orderId}`, `
      <h2>Thank you for your order!</h2>
      <p>Order ID: ${orderId}</p>
      <p>Amount: ${usdtAmount} USDT</p>
      <p>Send to: UQA51y59urbfZX33AMAhwCs2mEtI6hgTO2_1mXIp_hop-VEe</p>
    `);
    
    res.json({ success: true, orderId, usdtAmount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.post('/api/orders/:orderId/payment', async (req, res) => {
  try {
    const { txHash } = req.body;
    const order = orders.find(o => o.orderId === req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    order.txHash = txHash;
    order.status = 'payment_submitted';
    
    const verification = await verifyUsdtPayment(txHash, order.usdtAmount);
    
    if (verification.verified) {
      order.status = 'paid';
      order.verifiedAt = new Date().toISOString();
      
      await sendEmail(order.email, `Your eSIM is Ready! - ${order.orderId}`, `
        <h2>Your eSIM is Ready!</h2>
        <p>Order ID: ${order.orderId}</p>
        <p>Your eSIM QR code will be sent separately.</p>
      `);
    }
    
    res.json({ success: true, status: order.status, verified: verification.verified });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

app.get('/api/orders/:orderId/status', (req, res) => {
  const order = orders.find(o => o.orderId === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ orderId: order.orderId, status: order.status, txHash: order.txHash });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
