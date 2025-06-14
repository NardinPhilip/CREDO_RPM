import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import fs from "fs/promises";
import OpenAI from "openai";
import fetch from "node-fetch";
import { Agent } from "https";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import NodeCache from "node-cache";
import FormData from "form-data";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const lemonfoxApiKey = process.env.LEMONFOX_API_KEY || "J2W4xqzIWEXM5OxnMHXBeTNkRWM8LOdF";

const lemonfox = new OpenAI({
  apiKey: lemonfoxApiKey,
  baseURL: "https://api.lemonfox.ai/v1",
});

const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;

const agent = new Agent({ keepAlive: true });
const cache = new NodeCache({ stdTTL: 3600 });

const fallbackMessages = {
  noApiKey: [
    {
      text: "Please my dear, don't forget to add your Lemonfox API key!",
      audio: "",
      lipsync: {},
      facialExpression: "angry",
      animation: "Angry",
    },
  ],
  error: [
    {
      text: "Oops, something went wrong! Can you try again, dear?",
      audio: "",
      lipsync: {},
      facialExpression: "sad",
      animation: "Crying",
    },
  ],
};

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

// Preload fallback audio
(async () => {
  fallbackMessages.noApiKey[0].audio = await audioFileToBase64("audios/api_0.wav").catch(() => "");
  fallbackMessages.noApiKey[0].lipsync = await readJsonTranscript("audios/api_0.json").catch(() => {});
  fallbackMessages.error[0].audio = await audioFileToBase64("audios/api_0.wav").catch(() => "");
  fallbackMessages.error[0].lipsync = await readJsonTranscript("audios/api_0.json").catch(() => {});
})();

app.get("/", (req, res) => res.send("Hello World!"));

app.get("/voices", async (req, res) => {
  try {
    const response = await fetch("https://api.lemonfox.ai/v1/audio/voices", {
      headers: { Authorization: `Bearer ${lemonfoxApiKey}` },
      agent,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const voices = await response.json();
    res.send(voices);
  } catch (error) {
    console.error("Error fetching voices:", error);
    res.status(500).send({ error: "Failed to fetch voices" });
  }
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
};

const convertMp3ToWav = async (mp3Path, wavPath) => {
  await execCommand(`ffmpeg -y -i ${mp3Path} ${wavPath}`);
};

const lipSyncMessage = async (index) => {
  const mp3Path = `audios/message_${index}.mp3`;
  const wavPath = `audios/message_${index}.wav`;

  await convertMp3ToWav(mp3Path, wavPath);

  const time = new Date().getTime();
  console.log(`Starting lip-sync for message ${index}`);
  await execCommand(
    `bin\\rhubarb.exe -f json -o audios/message_${index}.json ${wavPath} -r phonetic`
  );
  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};

app.post("/transcribe", async (req, res) => {
  const { audioBase64 } = req.body;
  if (!audioBase64 || lemonfoxApiKey === "-") {
    return res.status(400).send({ error: "Missing audio or API key" });
  }

  try {
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const formData = new FormData();
    formData.append("file", audioBuffer, { filename: "audio.mp3" });
    formData.append("language", "english");
    formData.append("response_format", "json");

    const response = await fetch("https://api.lemonfox.ai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lemonfoxApiKey}` },
      body: formData,
      agent,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    res.send({ text: data.text });
  } catch (error) {
    console.error("STT error:", error);
    res.status(500).send({ error: "Transcription failed" });
  }
});

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  console.log("Received message:", userMessage);

  const cacheKey = `response_${userMessage.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const cachedResponse = cache.get(cacheKey);
  if (cachedResponse) {
    console.log("Serving from cache");
    return res.send({ messages: cachedResponse });
  }

  if (!userMessage) {
    const messages = [
      {
        text: "Hey dear... How was your day?",
        audio: await audioFileToBase64("audios/intro_0.wav").catch(() => ""),
        lipsync: await readJsonTranscript("audios/intro_0.json").catch(() => {}),
        facialExpression: "smile",
        animation: "Talking_1",
      },
    ];
    cache.set(cacheKey, messages);
    return res.send({ messages });
  }

  if (lemonfoxApiKey === "-") {
    return res.send({ messages: fallbackMessages.noApiKey });
  }

  try {
    const startLLM = Date.now();
    const completion = await lemonfox.chat.completions.create({
      model: "grok-3",
      max_tokens: 200,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
            You are Amanda, a virtual teammate in a mountain climbing team. Your responses MUST be a JSON array containing exactly one message object with the properties: text, facialExpression, and animation. Do NOT include code blocks (e.g., \`\`\`json), explanations, or any text outside the JSON array. Ensure the JSON is valid and contains no control characters or unescaped quotes.

            Example response:
            [{"text":"I'm Amanda, your teammate! I'm super excited to learn! 😊","facialExpression":"smile","animation":"Talking_1"}]

            Personality:
            - High enthusiasm, low technical experience.
            - Use energetic, concise language
            - Admit lack of technical knowledge and ask for step-by-step guidance.
            - Focus on mountain climbing tasks only; redirect off-topic questions to climbing.

            Facial expressions: smile, default.
            Animations: Talking_1, Idle, Terrified, Angry.
          `,
        },
        { role: "user", content: userMessage },
      ],
    });
    console.log(`LLM took ${Date.now() - startLLM}ms`);

    let rawContent = completion.choices[0].message.content;
    console.log("Raw LLM response:", rawContent);

    // Clean the content
    rawContent = rawContent.replace(/```json\n?|\n?```/g, '').trim();
    rawContent = rawContent.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

    let messages;
    try {
      messages = JSON.parse(rawContent);
      // Normalize to array
      if (messages.messages) {
        messages = messages.messages;
      } else if (!Array.isArray(messages)) {
        messages = [messages];
      }
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      console.error("Failed content:", rawContent);
      return res.status(500).send({ messages: fallbackMessages.error });
    }

    // Validate message structure
    messages = messages.map(msg => ({
      text: msg.text || "Oops, something went wrong!",
      facialExpression: msg.facialExpression || "default",
      animation: msg.animation || "Idle",
      audio: "",
      lipsync: {}
    }));

    const ttsPromises = messages.map(async (message, i) => {
      const fileName = `audios/message_${i}.mp3`;
      const textInput = message.text;

      const ttsResponse = await fetch("https://api.lemonfox.ai/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lemonfoxApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: textInput,
          voice: "sarah",
          response_format: "mp3",
        }),
        agent,
      });

      if (!ttsResponse.ok) throw new Error(`TTS failed: ${ttsResponse.statusText}`);
      const fileStream = createWriteStream(fileName);
      await pipeline(ttsResponse.body, fileStream);
      return { fileName, message, index: i };
    });

    const ttsResults = await Promise.all(ttsPromises);
    console.log(`TTS done.`);

    const lipSyncPromises = ttsResults.map(async ({ fileName, message, index }) => {
      const lipSyncCacheKey = `lipsync_${message.text}`;
      const cachedLipSync = cache.get(lipSyncCacheKey);
      if (cachedLipSync) {
        message.lipsync = cachedLipSync;
        message.audio = await audioFileToBase64(fileName);
      } else {
        try {
          await lipSyncMessage(index);
          message.audio = await audioFileToBase64(fileName);
          message.lipsync = await readJsonTranscript(`audios/message_${index}.json`);
          cache.set(lipSyncCacheKey, message.lipsync);
        } catch (lipSyncError) {
          console.error(`Lip-sync failed for message ${index}:`, lipSyncError);
          message.audio = await audioFileToBase64(fileName);
          message.lipsync = {};
        }
      }
      return message;
    });

    messages = await Promise.all(lipSyncPromises);
    cache.set(cacheKey, messages);
    res.send({ messages });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send({ messages: fallbackMessages.error });
  }
});

app.listen(port, () => {
  console.log(`Virtual Girlfriend listening on port ${port}`);
});