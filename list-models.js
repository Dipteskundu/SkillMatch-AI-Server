// backend/list-models.js
// Script to list all available Gemini models for your API key

import "dotenv/config";
import https from "https";

const apiKey = process.env.GEMINI_API_KEY?.trim();

if (!apiKey) {
  // error handled silently
}

async function listModels() {
  // error handled silently
  
  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          // error handled silently
          
          if (!response.models || response.models.length === 0) {
            // error handled silently
          }
          
          // error handled silently
          
          response.models.forEach((model, index) => {
            // error handled silently
          });
          
          // error handled silently
          
          const contentModels = response.models
            .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
            .map(m => m.name.replace('models/', ''));
          
          if (contentModels.length > 0) {
            // error handled silently
          }
          
          // error handled silently
          resolve(response.models);
        } catch (error) {
          // error handled silently
          // error handled silently
          reject(error);
        }
      });
    }).on('error', (error) => {
      // error handled silently
      reject(error);
    });
  });
}

listModels();