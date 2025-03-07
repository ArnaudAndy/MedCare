const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const crypto = require('crypto'); // For data encryption
const twilio = require('twilio');
require('dotenv').config();  // Load environment variables
const  cors  = require('cors')

const accountSid = process.env.ACCOUNT_SID;
const authToken = process.env.AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const encryptionKey = process.env.ENCRYPTION_KEY || 'default_secret_key'; // 32-byte key for AES encryption

const client = twilio(accountSid, authToken);

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

const app = express();
app.use(bodyParser.json());
app.use(cors());

let verificationCodes = {};

// 🔹 Function to Encrypt Medical Data
const encryptData = (data) => {
    const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey.substring(0, 32), encryptionKey.substring(0, 16));
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
};

// 🔹 Function to Decrypt Medical Data
const decryptData = (encryptedData) => {
    const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey.substring(0, 32), encryptionKey.substring(0, 16));
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
};

// 🔹 Send SMS function
const sendSms = async (phoneNumber, message) => {
    try {
        const response = await client.messages.create({
            body: message,
            from: twilioPhoneNumber,
            to: `+237${phoneNumber}`
        });
        console.log('✅ SMS sent:', response.sid);
        return true;
    } catch (error) {
        console.error('❌ Error sending SMS:', error.message);
        return false;
    }
};

// 🔹 Send Verification Code
app.post('/send-code', async (req, res) => {
    const { phoneNumber, name, email = '' } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required' });

    const code = Math.floor(1000 + Math.random() * 9000);
    verificationCodes[phoneNumber] = { code, name, email };

    const message = `Your verification code is ${code}`;
    const smsSent = await sendSms(phoneNumber, message);

    if (smsSent) {
        res.json({ message: 'Verification code sent!' });
    } else {
        res.json({ 
            message: 'Failed to send SMS. You can enter the universal code 5555 or 55550 to proceed.' 
        });
    }
});

// 📌 Verify Code & Save User (Ensuring Unique Phone Numbers)
app.post('/verify-code', async (req, res) => {
    const { phoneNumber, code } = req.body;
    if (!phoneNumber || !code) return res.status(400).json({ error: 'Phone number and code are required' });

    const storedCode = verificationCodes[phoneNumber]?.code;

    if (storedCode === parseInt(code) || code === "5555" || code === "55550") {
        const { name, email } = verificationCodes[phoneNumber];

        const checkQuery = 'SELECT * FROM users WHERE phoneNumber = ?';
        connection.query(checkQuery, [phoneNumber], (err, results) => {
            if (err) return res.status(500).json({ error: 'Database error' });

            if (results.length > 0) {
                const updateQuery = 'UPDATE users SET name = ?, email = ? WHERE phoneNumber = ?';
                connection.query(updateQuery, [name, email, phoneNumber], (err) => {
                    if (err) return res.status(500).json({ error: 'Database update error' });
                    res.json({ message: 'User updated successfully!', name, email });
                });
            } else {
                const insertQuery = 'INSERT INTO users (name, phoneNumber, email) VALUES (?, ?, ?)';
                connection.query(insertQuery, [name, phoneNumber, email], (err) => {
                    if (err) return res.status(500).json({ error: 'Database insert error' });
                    res.json({ message: 'User registered successfully!', name, email });
                });
            }
        });
    } else {
        res.status(400).json({ error: 'Invalid verification code' });
    }
});

// 🔹 Store Medical Record
app.post('/store-record', (req, res) => {
    const { phoneNumber, diagnosis, prescription } = req.body;
    if (!phoneNumber || !diagnosis || !prescription) {
        return res.status(400).json({ error: 'Phone number, diagnosis, and prescription are required' });
    }

    const encryptedDiagnosis = encryptData(diagnosis);
    const encryptedPrescription = encryptData(prescription);

    const insertQuery = 'INSERT INTO medical_records (phoneNumber, diagnosis, prescription) VALUES (?, ?, ?)';
    connection.query(insertQuery, [phoneNumber, encryptedDiagnosis, encryptedPrescription], (err) => {
        if (err) return res.status(500).json({ error: 'Database insert error' });
        res.json({ message: 'Medical record stored securely!' });
    });
});

// 🔹 Retrieve Medical Record
app.get('/get-records/:phoneNumber', (req, res) => {
    const { phoneNumber } = req.params;

    const selectQuery = 'SELECT * FROM medical_records WHERE phoneNumber = ?';
    connection.query(selectQuery, [phoneNumber], (err, results) => {
        if (err) return res.status(500).json({ error: 'Database retrieval error' });

        if (results.length === 0) {
            return res.status(404).json({ message: 'No records found' });
        }

        const decryptedRecords = results.map(record => ({
            diagnosis: decryptData(record.diagnosis),
            prescription: decryptData(record.prescription)
        }));

        res.json({ records: decryptedRecords });
    });
});

// 🔹 Database Schema for Medical Records (Run this in MySQL)
/*
CREATE TABLE medical_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phoneNumber VARCHAR(15),
    diagnosis TEXT NOT NULL,
    prescription TEXT NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
*/

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
