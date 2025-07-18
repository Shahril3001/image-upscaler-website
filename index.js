const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const cors = require('cors'); // Add CORS support
const rateLimit = require('express-rate-limit'); // Add rate limiting
const upscaleImage = require('./upscale');

const app = express();

// Add middleware
app.use(cors()); // Enable CORS for frontend communication
app.use(express.json()); // For potential API expansion

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Configure multer with better file handling
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { 
    fileSize: 20 * 1024 * 1024, // Max: 20MB
    files: 10 // Max 10 files per request
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WEBP are allowed.'));
    }
  }
});

// Ensure necessary folders exist
['uploads', 'outputs'].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Cleanup function to remove old files
const cleanupOldFiles = () => {
  const directories = ['uploads', 'outputs'];
  const maxAge = 30 * 60 * 1000; // 30 minutes in milliseconds

  directories.forEach(dir => {
    fs.readdir(dir, (err, files) => {
      if (err) return;

      files.forEach(file => {
        const filePath = path.join(dir, file);
        fs.stat(filePath, (err, stat) => {
          if (err) return;

          const now = new Date().getTime();
          const fileAge = now - new Date(stat.mtime).getTime();

          if (fileAge > maxAge) {
            fs.unlink(filePath, err => {
              if (err) console.error(`Error deleting file ${filePath}:`, err);
            });
          }
        });
      });
    });
  });
};

// Run cleanup every hour
setInterval(cleanupOldFiles, 60 * 60 * 1000);
cleanupOldFiles(); // Run immediately on startup

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// POST /upscale API with enhanced error handling
app.post('/upscale', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ 
      error: 'No image file uploaded',
      details: 'Please provide a valid image file (JPEG, PNG, WEBP) under 20MB'
    });
  }

  try {
    const startTime = Date.now();
    const outputPath = await upscaleImage(req.file.path, path.join(__dirname, 'outputs'));
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

    const contentType = mime.lookup(outputPath) || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    
    // Add some metadata to the response
    res.setHeader('X-Processing-Time', `${processingTime}s`);
    res.setHeader('X-File-Size', fs.statSync(outputPath).size);

    // Stream the file instead of loading it all into memory
    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);

    fileStream.on('finish', () => {
      // Cleanup files after streaming is complete
      try {
        fs.unlink(req.file.path, () => {});
        fs.unlink(outputPath, () => {});
      } catch (err) {
        console.error('Error cleaning up files:', err);
      }
    });

    fileStream.on('error', (err) => {
      console.error('File streaming error:', err);
      try {
        fs.unlink(req.file.path, () => {});
        fs.unlink(outputPath, () => {});
      } catch (cleanupErr) {
        console.error('Error cleaning up files after stream error:', cleanupErr);
      }
      res.status(500).json({ 
        error: 'File streaming failed',
        details: err.message 
      });
    });

  } catch (err) {
    console.error('Upscaling error:', err);
    
    // Cleanup any created files
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }

    res.status(500).json({
      error: 'Image upscaling failed',
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error: 'File upload error',
      details: err.message
    });
  }
  
  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`✅ Server running at: http://localhost:${PORT}`);
});

// Handle server shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});