const express = require('express');
const cors = require('cors');
const db = require('./database');
const QRCode = require('qrcode');
const os = require('os');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Hash password
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Admin secret code (change this to your secret)
const ADMIN_SECRET_CODE = 'ADMIN2025';

// Check if user is admin
function isAdmin(username, password) {
  return username.toLowerCase().startsWith('admin') && password.includes(ADMIN_SECRET_CODE);
}

// Register new employee or admin
app.post('/api/register', (req, res) => {
  const { employee_id, name, username, password } = req.body;
  
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  
  // Check if registering as admin
  if (isAdmin(username, password)) {
    // Register as admin
    const hashedPassword = hashPassword(password);
    
    db.run(
      'INSERT INTO admins (username, password, name) VALUES (?, ?, ?)',
      [username, hashedPassword, name],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: err.message });
        }
        
        db.get('SELECT id, username, name, created_at FROM admins WHERE id = ?', [this.lastID], (err, admin) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json({ success: true, user: { ...admin, role: 'admin' } });
        });
      }
    );
  } else {
    // Register as employee
    if (!employee_id) {
      return res.status(400).json({ error: 'Employee ID is required for employee accounts' });
    }
    
    const hashedPassword = hashPassword(password);
    
    db.run(
      'INSERT INTO employees (employee_id, name, username, password) VALUES (?, ?, ?, ?)',
      [employee_id, name, username, hashedPassword],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Employee ID or username already exists' });
          }
          return res.status(500).json({ error: err.message });
        }
        
        db.get('SELECT id, employee_id, name, username, created_at FROM employees WHERE id = ?', [this.lastID], (err, employee) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json({ success: true, user: { ...employee, role: 'employee' } });
        });
      }
    );
  }
});

// Login employee or admin
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  const hashedPassword = hashPassword(password);
  
  // Check if trying to login as admin
  if (username.toLowerCase().startsWith('admin')) {
    db.get(
      'SELECT id, username, name, created_at FROM admins WHERE username = ? AND password = ?',
      [username, hashedPassword],
      (err, admin) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        if (!admin) {
          return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        res.json({ success: true, user: { ...admin, role: 'admin' } });
      }
    );
  } else {
    // Login as employee
    db.get(
      'SELECT id, employee_id, name, username, created_at FROM employees WHERE username = ? AND password = ?',
      [username, hashedPassword],
      (err, employee) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        if (!employee) {
          return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        res.json({ success: true, user: { ...employee, role: 'employee' } });
      }
    );
  }
});

// Register or get employee (legacy - for backward compatibility)
app.post('/api/employees', (req, res) => {
  const { employee_id, name } = req.body;
  
  db.get('SELECT id, employee_id, name, username, created_at FROM employees WHERE employee_id = ?', [employee_id], (err, employee) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (employee) {
      return res.json(employee);
    }
    
    res.status(404).json({ error: 'Employee not found. Please register first.' });
  });
});

// Get all employees (without passwords)
app.get('/api/employees', (req, res) => {
  db.all('SELECT id, employee_id, name, username, created_at FROM employees ORDER BY name', [], (err, employees) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(employees);
  });
});

// Clock in
app.post('/api/clock-in', (req, res) => {
  const { employee_id } = req.body;
  
  // Check if already clocked in
  db.get('SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL', [employee_id], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (existing) {
      return res.status(400).json({ error: 'Already clocked in' });
    }
    
    db.run('INSERT INTO attendance (employee_id, clock_in) VALUES (?, datetime("now", "localtime"))', [employee_id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      db.get('SELECT * FROM attendance WHERE id = ?', [this.lastID], (err, record) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json(record);
      });
    });
  });
});

// Clock out
app.post('/api/clock-out', (req, res) => {
  const { employee_id, notes } = req.body;
  
  db.get('SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1', [employee_id], (err, record) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (!record) {
      return res.status(400).json({ error: 'No active clock-in found' });
    }
    
    db.run(`
      UPDATE attendance 
      SET clock_out = datetime("now", "localtime"),
          hours_worked = ROUND((julianday(datetime("now", "localtime")) - julianday(clock_in)) * 24, 2),
          notes = ?
      WHERE id = ?
    `, [notes || null, record.id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      db.get('SELECT * FROM attendance WHERE id = ?', [record.id], (err, updated) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json(updated);
      });
    });
  });
});

// Get employee status
app.get('/api/status/:employee_id', (req, res) => {
  const { employee_id } = req.params;
  
  db.get('SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL', [employee_id], (err, record) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json({ 
      clocked_in: !!record,
      record: record || null
    });
  });
});

// Get attendance records with filters
app.get('/api/attendance', (req, res) => {
  const { employee_id, start_date, end_date } = req.query;
  
  let query = `
    SELECT a.*, e.name as employee_name
    FROM attendance a
    JOIN employees e ON a.employee_id = e.employee_id
    WHERE 1=1
  `;
  const params = [];
  
  if (employee_id) {
    query += ' AND a.employee_id = ?';
    params.push(employee_id);
  }
  
  if (start_date) {
    query += ' AND date(a.clock_in) >= date(?)';
    params.push(start_date);
  }
  
  if (end_date) {
    query += ' AND date(a.clock_in) <= date(?)';
    params.push(end_date);
  }
  
  query += ' ORDER BY a.clock_in DESC';
  
  db.all(query, params, (err, records) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(records);
  });
});

// Generate payroll summary
app.get('/api/payroll-summary', (req, res) => {
  const { start_date, end_date } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  
  db.all(`
    SELECT 
      e.employee_id,
      e.name,
      COUNT(a.id) as total_days,
      ROUND(SUM(COALESCE(a.hours_worked, 0)), 2) as total_hours,
      COUNT(CASE WHEN a.clock_out IS NULL THEN 1 END) as incomplete_records
    FROM employees e
    LEFT JOIN attendance a ON e.employee_id = a.employee_id
      AND date(a.clock_in) >= date(?)
      AND date(a.clock_in) <= date(?)
    GROUP BY e.employee_id, e.name
    ORDER BY e.name
  `, [start_date, end_date], (err, summary) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(summary);
  });
});

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Generate QR code for employee
app.get('/api/qr/:employee_id', async (req, res) => {
  const { employee_id } = req.params;
  const localIP = getLocalIP();
  const url = `http://${localIP}:${PORT}/mobile.html?id=${employee_id}`;
  
  try {
    const qrCode = await QRCode.toDataURL(url, { width: 300 });
    res.json({ qrCode, url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate attendance check QR code (for scanning)
app.get('/api/qr-attendance', async (req, res) => {
  const localIP = getLocalIP();
  const url = `http://${localIP}:${PORT}/attendance-scan.html`;
  
  try {
    const qrCode = await QRCode.toDataURL(url, { width: 400 });
    res.json({ qrCode, url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Attendance scan endpoint (triggered by QR code)
app.post('/api/attendance-scan', (req, res) => {
  const { employee_id } = req.body;
  
  if (!employee_id) {
    return res.status(400).json({ error: 'Employee ID required' });
  }
  
  // Check current status
  db.get('SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL', [employee_id], (err, record) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (record) {
      // Already clocked in, so clock out
      db.run(`
        UPDATE attendance 
        SET clock_out = datetime("now", "localtime"),
            hours_worked = ROUND((julianday(datetime("now", "localtime")) - julianday(clock_in)) * 24, 2)
        WHERE id = ?
      `, [record.id], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        res.json({ action: 'clock-out', success: true, message: 'Clocked out successfully' });
      });
    } else {
      // Not clocked in, so clock in
      db.run('INSERT INTO attendance (employee_id, clock_in) VALUES (?, datetime("now", "localtime"))', [employee_id], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        res.json({ action: 'clock-in', success: true, message: 'Clocked in successfully' });
      });
    }
  });
});

// Serve login page at root (must be before static files)
app.get('/', (req, res) => {
  res.sendFile('login.html', { root: require('path').join(__dirname, '../frontend') });
});

// Serve static files
app.use(express.static(require('path').join(__dirname, '../frontend')));

app.listen(PORT, () => {
  const localIP = getLocalIP();
  console.log(`Attendance system running on:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}`);
  console.log(`\nEmployees can scan QR codes to access from mobile devices`);
});
