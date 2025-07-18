const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

async function upscaleImage(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(inputPath) || '.png';  // fallback to .png if input has no extension
    const basename = path.basename(inputPath, ext);
    const outputFilename = `upscaled_${basename}${ext}`;
    const outputPath = path.join(outputDir, outputFilename);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const executablePath = path.join(__dirname, 'realesrgan-ncnn-vulkan.exe');

    if (!fs.existsSync(executablePath)) {
      return reject(new Error('RealESRGAN executable not found. Please place realesrgan-ncnn-vulkan.exe in the project root.'));
    }

    // Prepare arguments with the -m option to specify the model folder
    const args = [
      '-i', inputPath,
      '-o', outputPath,
      '-m', path.join(__dirname, 'models'),  // Path to the models directory
      '-n', 'realesrgan-x4plus',  // Model name
      '-s', '4'  // Scale factor
    ];

    console.log(`Running: ${executablePath} ${args.join(' ')}`);

    const process = spawn(executablePath, args);

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(data.toString());
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(data.toString());
    });

    process.on('close', (code) => {
      if (code === 0) {
        if (fs.existsSync(outputPath)) {
          resolve(outputPath);
        } else {
          reject(new Error('Upscaling completed but output file not found'));
        }
      } else {
        reject(new Error(`RealESRGAN failed with code ${code}: ${stderr}`));
      }
    });

    process.on('error', (err) => {
      reject(new Error(`Failed to start RealESRGAN: ${err.message}`));
    });
  });
}

module.exports = upscaleImage;