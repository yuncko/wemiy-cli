import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

export const config = {
    googleApiKey: (process.env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim(),
    model: (process.env.ORBITAL_MODEL || 'gemini-2.5-flash').trim(),
};
