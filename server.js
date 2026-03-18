const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database file path
const DB_FILE = path.join(__dirname, 'database', 'orders.json');

// Ensure database directory exists
async function ensureDbDir() {
  const dbDir = path.dirname(DB_FILE);
  try {
    await fs.mkdir(dbDir, { recursive: true });
  } catch (err) {
    console.log('Database directory already exists');
  }
}

// Initialize database
async function initDatabase() {
  await ensureDbDir();
  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify({ orders: [] }, null, 2));
  }
}

// Read database
async function readDb() {
  const data = await fs.readFile(DB_FILE, 'utf8');
  return JSON.parse(data);
}

// Write database
async function writeDb(data) {
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

// Generate unique order ID
function generateOrderId() {
  return 'ESIM-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}

// Convert KRW to USDT
function krwToUsdt(krwAmount) {
  const rate = parseInt(process.env.USDT_KRW_RATE) || 1350;
  return (krwAmount / rate).toFixed(2);
}

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT) || 465,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Send email notification
async function sendEmail(to, subject, html) {
  try {
    const info = await transporter.sendMail({
      from: `"eSIM Global" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log('Email sent:', info.messageId);
    return true;
  } catch (error) {
    console.error('Email error:', error);
    return false;
  }
}

// Send order confirmation to customer
async function sendOrderConfirmation(order) {
  const subject = `Order Confirmation - ${order.orderId}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">Thank you for your order!</h2>
      <p>Your order has been received and is being processed.</p>
      
      <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Order Details</h3>
        <p><strong>Order ID:</strong> ${order.orderId}</p>
        <p><strong>Amount:</strong> ${order.usdtAmount} USDT</p>
        <p><strong>Status:</strong> ${order.status}</p>
      </div>
      
      <h3>Items Ordered:</h3>
      <ul>
        ${order.items.map(item => `
          <li>${item.country_display} - ${item.product_name} (Qty: ${item.quantity})</li>
        `).join('')}
      </ul>
      
      <p>We will send your eSIM QR code to this email once payment is confirmed.</p>
      
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 14px;">
          Need help? Contact us:<br>
          Phone: ${process.env.ADMIN_PHONE}<br>
          Email: ${process.env.ADMIN_EMAIL}
        </p>
      </div>
    </div>
  `;
  
  return await sendEmail(order.email, subject, html);
}

// Send notification to admin
async function sendAdminNotification(order, type = 'new') {
  const subject = type === 'verified' 
    ? `✅ Payment Verified - ${order.orderId}`
    : type === 'failed'
    ? `❌ Verification Failed - ${order.orderId}`
    : `🛒 New Order - ${order.orderId}`;
    
  const html = `
    <div style="font-family: Arial, sans-serif;">
      <h2>${type === 'verified' ? 'Payment Verified!' : type === 'failed' ? 'Verification Failed!' : 'New Order Received!'}</h2>
      
      <div style="background: #f3f4f6; padding: 20px; border-radius: 8px;">
        <p><strong>Order ID:</strong> ${order.orderId}</p>
        <p><strong>Customer:</strong> ${order.firstName} ${order.lastName}</p>
        <p><strong>Email:</strong> ${order.email}</p>
        <p><strong>Phone:</strong> ${order.phone || 'N/A'}</p>
        <p><strong>Amount:</strong> ${order.usdtAmount} USDT (₩${order.totalKrw.toLocaleString()})</p>
        <p><strong>Status:</strong> ${order.status}</p>
        <p><strong>TX Hash:</strong> ${order.txHash || 'Pending'}</p>
      </div>
      
      <h3>Items:</h3>
      <ul>
        ${order.items.map(item => `
          <li>${item.country_display} - ${item.product_name} (Qty: ${item.quantity})</li>
        `).join('')}
      </ul>
      
      ${type === 'failed' ? `
        <div style="background: #fee2e2; padding: 15px; border-radius: 8px; margin-top: 20px;">
          <p><strong>Action Required:</strong> Please verify this payment manually at:</p>
          <p><a href="https://tonscan.org/address/${process.env.USDT_ADDRESS}">View on Tonscan</a></p>
        </div>
      ` : ''}
    </div>
  `;
  
  return await sendEmail(process.env.ADMIN_EMAIL, subject, html);
}

// Send eSIM to customer after payment confirmation
async function sendEsim(order) {
  const subject = `Your eSIM is Ready! - ${order.orderId}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #059669;">Your eSIM is Ready!</h2>
      <p>Thank you for your payment. Your eSIM has been activated.</p>
      
      <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #10b981;">
        <h3 style="margin-top: 0; color: #059669;">How to Install Your eSIM</h3>
        <ol style="padding-left: 20px;">
          <li>Open your phone's <strong>Settings</strong></li>
          <li>Go to <strong>Connections</strong> or <strong>Cellular</strong></li>
          <li>Tap <strong>Add eSIM</strong> or <strong>Add Cellular Plan</strong></li>
          <li>Scan the QR code below or enter details manually</li>
        </ol>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <p style="color: #6b7280; margin-bottom: 10px;">Your eSIM QR Code:</p>
        <div style="background: #f3f4f6; padding: 40px; border-radius: 8px; display: inline-block;">
          <p style="font-size: 14px; color: #6b7280;">[QR CODE PLACEHOLDER]</p>
          <p style="font-size: 12px; color: #9ca3af; margin-top: 10px;">
            In production, this would be your actual eSIM QR code
          </p>
        </div>
      </div>
      
      <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0; color: #92400e;">
          <strong>Important:</strong> This eSIM is for ${order.items[0]?.country_display || 'your destination'}. 
          Please activate it after arriving at your destination.
        </p>
      </div>
      
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 14px;">
          Need help? Contact us:<br>
          Phone: ${process.env.ADMIN_PHONE}<br>
          Email: ${process.env.ADMIN_EMAIL}
        </p>
      </div>
    </div>
  `;
  
  return await sendEmail(order.email, subject, html);
}

// Verify USDT payment using TonAPI (with API key)
async function verifyUsdtPayment(txHash, expectedAmount) {
  try {
    console.log('Verifying payment with TonAPI:', txHash);
    
    const url = `${process.env.TONAPI_IO}/blockchain/transactions/${txHash}`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${process.env.TON_API_KEY}`
      }
    });
    
    const tx = response.data;
    console.log('Transaction data:', JSON.stringify(tx, null, 2));
    
    if (tx.jetton_transfers && tx.jetton_transfers.length > 0) {
      const jettonTransfer = tx.jetton_transfers[0];
      const jettonAddress = jettonTransfer.jetton?.address || jettonTransfer.jetton_address;
      const USDT_JETTON_MASTER = process.env.USDT_JETTON_MASTER || 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7L2g7MdB9Y';
      
      const isUsdt = jettonAddress === USDT_JETTON_MASTER;
      const recipientAddress = jettonTransfer.destination?.address || jettonTransfer.destination;
      const isCorrectRecipient = recipientAddress === process.env.USDT_ADDRESS;
      
      const rawAmount = jettonTransfer.amount;
      const actualAmount = (parseInt(rawAmount) / 1000000).toFixed(2);
      
      const expected = parseFloat(expectedAmount);
      const actual = parseFloat(actualAmount);
      const amountMatches = Math.abs(expected - actual) < 0.01;
      
      console.log('Verification results:', { isUsdt, isCorrectRecipient, amountMatches });
      
      if (isUsdt && isCorrectRecipient && amountMatches) {
        return {
          verified: true,
          transaction: {
            hash: txHash,
            amount: actualAmount,
            sender: jettonTransfer.source?.address || jettonTransfer.source,
            recipient: recipientAddress,
            timestamp: tx.utime,
          }
        };
      }
      
      return {
        verified: false,
        error: !isUsdt ? 'Not a USDT transaction' : 
               !isCorrectRecipient ? 'Wrong recipient address' : 
               'Amount mismatch'
      };
    }
    
    return { verified: false, error: 'No Jetton transfer found in transaction' };
    
  } catch (error) {
    console.error('TonAPI verification error:', error.message);
    return { verified: false, error: error.message };
  }
}

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    usdtAddress: process.env.USDT_ADDRESS 
  });
});

// Get payment info (for frontend)
app.get('/api/payment-info', (req, res) => {
  res.json({
    usdtAddress: process.env.USDT_ADDRESS,
    exchangeRate: parseInt(process.env.USDT_KRW_RATE) || 1350,
    expiryMinutes: parseInt(process.env.PAYMENT_EXPIRY_MINUTES) || 60,
  });
});

// Create new order
app.post('/api/orders', async (req, res) => {
  try {
    const { email, firstName, lastName, phone, items, totalKrw } = req.body;
    
    if (!email || !firstName || !lastName || !items || !totalKrw) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const orderId = generateOrderId();
    const usdtAmount = krwToUsdt(totalKrw);
    const expiryTime = new Date();
    expiryTime.setMinutes(expiryTime.getMinutes() + (parseInt(process.env.PAYMENT_EXPIRY_MINUTES) || 60));
    
    const order = {
      orderId,
      email,
      firstName,
      lastName,
      phone: phone || '',
      items,
      totalKrw,
      usdtAmount,
      status: 'pending_payment',
      txHash: null,
      createdAt: new Date().toISOString(),
      expiresAt: expiryTime.toISOString(),
      verifiedAt: null,
      esimSentAt: null,
    };
    
    const db = await readDb();
    db.orders.push(order);
    await writeDb(db);
    
    await sendOrderConfirmation(order);
    await sendAdminNotification(order, 'new');
    
    res.json({
      success: true,
      orderId,
      usdtAmount,
      usdtAddress: process.env.USDT_ADDRESS,
      expiresAt: order.expiresAt,
    });
    
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Get order by ID
app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const db = await readDb();
    const order = db.orders.find(o => o.orderId === orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json(order);
    
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Failed to get order' });
  }
});

// Submit payment (customer submits TX hash)
app.post('/api/orders/:orderId/payment', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { txHash } = req.body;
    
    if (!txHash) {
      return res.status(400).json({ error: 'Transaction hash is required' });
    }
    
    const db = await readDb();
    const orderIndex = db.orders.findIndex(o => o.orderId === orderId);
    
    if (orderIndex === -1) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const order = db.orders[orderIndex];
    
    if (new Date() > new Date(order.expiresAt)) {
      order.status = 'expired';
      await writeDb(db);
      return res.status(400).json({ error: 'Order has expired' });
    }
    
    order.txHash = txHash;
    order.status = 'payment_submitted';
    order.paymentSubmittedAt = new Date().toISOString();
    
    await writeDb(db);
    
    verifyAndProcessPayment(orderId);
    
    res.json({
      success: true,
      message: 'Payment submitted successfully. Verification in progress.',
      orderId,
      status: order.status,
    });
    
  } catch (error) {
    console.error('Submit payment error:', error);
    res.status(500).json({ error: 'Failed to submit payment' });
  }
});

// Verify payment and process order
async function verifyAndProcessPayment(orderId) {
  try {
    const db = await readDb();
    const orderIndex = db.orders.findIndex(o => o.orderId === orderId);
    
    if (orderIndex === -1) return;
    
    const order = db.orders[orderIndex];
    
    if (!order.txHash) return;
    
    const verification = await verifyUsdtPayment(order.txHash, order.usdtAmount);
    
    if (verification.verified) {
      order.status = 'paid';
      order.verifiedAt = new Date().toISOString();
      order.transactionDetails = verification.transaction;
      
      await writeDb(db);
      
      await sendEsim(order);
      await sendAdminNotification(order, 'verified');
      
      console.log(`✅ Order ${orderId} verified and processed!`);
    } else {
      console.log(`⏳ Order ${orderId} not verified yet:`, verification.error);
      
      if (!order.verificationAttempts) order.verificationAttempts = 0;
      order.verificationAttempts++;
      
      await writeDb(db);
      
      if (order.verificationAttempts < 12) {
        setTimeout(() => verifyAndProcessPayment(orderId), 5 * 60 * 1000);
      } else {
        order.status = 'verification_failed';
        await writeDb(db);
        await sendAdminNotification(order, 'failed');
        console.log(`❌ Order ${orderId} verification failed after 12 attempts`);
      }
    }
    
  } catch (error) {
    console.error('Verification processing error:', error);
  }
}

// Manual verification endpoint (for admin)
app.post('/api/admin/verify-order', async (req, res) => {
  try {
    const { orderId, adminKey } = req.body;
    
    if (adminKey !== 'your-admin-secret-key') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const db = await readDb();
    const order = db.orders.find(o => o.orderId === orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    order.status = 'paid';
    order.verifiedAt = new Date().toISOString();
    order.manuallyVerified = true;
    
    await writeDb(db);
    await sendEsim(order);
    
    res.json({ success: true, message: 'Order verified manually' });
    
  } catch (error) {
    console.error('Manual verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Get all orders (for admin panel)
app.get('/api/admin/orders', async (req, res) => {
  try {
    const { adminKey, status } = req.query;
    
    if (adminKey !== 'your-admin-secret-key') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const db = await readDb();
    let orders = db.orders;
    
    if (status) {
      orders = orders.filter(o => o.status === status);
    }
    
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json(orders);
    
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to get orders' });
  }
});

// Check payment status (for frontend polling)
app.get('/api/orders/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const db = await readDb();
    const order = db.orders.find(o => o.orderId === orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json({
      orderId: order.orderId,
      status: order.status,
      txHash: order.txHash,
      verifiedAt: order.verifiedAt,
      esimSentAt: order.esimSentAt,
    });
    
  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Start server
async function startServer() {
  await initDatabase();
  
  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🚀 eSIM Payment Server Started!                              ║
║                                                                ║
║   Server URL: http://localhost:${PORT}                          ║
║   Admin Panel: http://localhost:${PORT}/admin.html              ║
║                                                                ║
║   API Key: ✅ Configured                                       ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
    `);
  });
}

startServer().catch(console.error);
