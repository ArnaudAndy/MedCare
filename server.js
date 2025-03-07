const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const crypto = require('crypto');
const twilio = require('twilio');
require('dotenv').config();
const cors = require('cors');

const accountSid = process.env.ACCOUNT_SID;
const authToken = process.env.AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const encryptionKey = process.env.ENCRYPTION_KEY || '01234567890123456789012345678901'; // 32-byte key

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

// 🔹 Helper function to generate a 16-byte IV
const generateIV = () => crypto.randomBytes(16);

// 🔹 Encrypt Data
const encryptData = (data) => {
    const key = Buffer.from(encryptionKey, 'utf8');
    const iv = generateIV();
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + encrypted; // Store IV + encrypted data
};

// 🔹 Decrypt Data
const decryptData = (encryptedData) => {
    try {
        const key = Buffer.from(encryptionKey, 'utf8');
        const iv = Buffer.from(encryptedData.substring(0, 32), 'hex'); // Extract IV (first 32 chars)
        const encryptedText = encryptedData.substring(32); // Remaining text

        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        console.error("❌ Decryption Error:", error.message);
        return null; // Return null if decryption fails
    }
};

// 🔹 CRUD Operations for Medical Records

// 📌 CREATE: Store Medical Record
app.post('/store-record', (req, res) => {
    const { phoneNumber, diagnosis, prescription } = req.body;
    if (!phoneNumber || !diagnosis || !prescription) {
        return res.status(400).json({ error: 'Phone number, diagnosis, and prescription are required' });
    }

    const encryptedDiagnosis = encryptData(diagnosis);
    const encryptedPrescription = encryptData(prescription);

    const query = 'INSERT INTO medical_records (phoneNumber, diagnosis, prescription) VALUES (?, ?, ?)';
    connection.query(query, [phoneNumber, encryptedDiagnosis, encryptedPrescription], (err) => {
        if (err) return res.status(500).json({ error: 'Database insert error' });
        res.json({ message: 'Medical record stored securely!' });
    });
});

// 📌 READ: Get Medical Records for a User
app.get('/get-records/:phoneNumber', (req, res) => {
    const { phoneNumber } = req.params;

    const query = 'SELECT * FROM medical_records WHERE phoneNumber = ?';
    connection.query(query, [phoneNumber], (err, results) => {
        if (err) return res.status(500).json({ error: 'Database retrieval error' });

        if (results.length === 0) {
            return res.status(404).json({ message: 'No records found' });
        }

        const decryptedRecords = results.map(record => ({
            id: record.id,
            diagnosis: decryptData(record.diagnosis),
            prescription: decryptData(record.prescription),
            createdAt: record.createdAt
        })).filter(record => record.diagnosis && record.prescription); // Filter out records with decryption errors

        res.json({ records: decryptedRecords });
    });
});

// 📌 UPDATE: Update an Existing Medical Record
app.put('/update-record/:id', (req, res) => {
    const { id } = req.params;
    const { diagnosis, prescription } = req.body;

    if (!diagnosis || !prescription) {
        return res.status(400).json({ error: 'Diagnosis and prescription are required' });
    }

    const encryptedDiagnosis = encryptData(diagnosis);
    const encryptedPrescription = encryptData(prescription);

    const query = 'UPDATE medical_records SET diagnosis = ?, prescription = ? WHERE id = ?';
    connection.query(query, [encryptedDiagnosis, encryptedPrescription, id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Database update error' });

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'No record found to update' });
        }

        res.json({ message: 'Medical record updated successfully!' });
    });
});

// 📌 DELETE: Delete a Medical Record
app.delete('/delete-record/:id', (req, res) => {
    const { id } = req.params;

    const query = 'DELETE FROM medical_records WHERE id = ?';
    connection.query(query, [id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Database delete error' });

        if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'No record found to delete' });
        }

        res.json({ message: 'Medical record deleted successfully!' });
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
