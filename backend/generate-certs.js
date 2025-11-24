#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  console.log('✅ Certificates already exist');
  process.exit(0);
}

console.log('🔐 Generating self-signed SSL certificates...');

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

try {
  const selfsigned = require('selfsigned');
  
  const localIP = getLocalIP();
  
  const attrs = [
    { name: 'commonName', value: 'localhost' },
    { name: 'organizationName', value: 'Attendance System' }
  ];
  
  const extensions = [
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 2, value: '127.0.0.1' },
        { type: 2, value: localIP },
        { type: 2, value: '*.local' }
      ]
    }
  ];
  
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 4096,
    algorithm: 'sha256',
    extensions: extensions
  });
  
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(keyPath, pems.private);
  
  console.log('✅ Certificates generated successfully!');
  console.log('📍 Location: backend/cert.pem and backend/key.pem');
  console.log('⏰ Valid for 365 days');
  console.log('\n📱 Certificate includes:');
  console.log('   • localhost');
  console.log('   • 127.0.0.1');
  console.log('   • ' + localIP);
  console.log('   • *.local');
  console.log('\n💡 Use this IP on mobile: https://' + localIP + ':3001');
} catch (error) {
  if (error.code === 'MODULE_NOT_FOUND') {
    console.error('❌ selfsigned package not found');
    console.error('Installing selfsigned package...');
    
    const { execSync } = require('child_process');
    try {
      execSync('npm install selfsigned --save-dev', { cwd: __dirname, stdio: 'inherit' });
      console.log('\n🔄 Retrying certificate generation...');
      require('child_process').execSync('node generate-certs.js', { cwd: __dirname, stdio: 'inherit' });
    } catch (installError) {
      console.error('Failed to install selfsigned package');
      process.exit(1);
    }
  } else {
    console.error('❌ Error generating certificates:', error.message);
    process.exit(1);
  }
}
