import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 讯飞API配置
const XF_CONFIG = {
  HOST: 'spark-api.cn-huabei-1.xf-yun.com',
  API_PATH: '/v2.1/tti',
  APP_ID: process.env.XF_APP_ID,
  API_KEY: process.env.XF_API_KEY,
  API_SECRET: process.env.XF_API_SECRET
};

// 内存存储聊天记录 (生产环境建议使用数据库)
const chatSessions = new Map();

// 生成讯飞API签名
function generateXfSignature() {
  const date = new Date().toGMTString();
  const signatureStr = `host: ${XF_CONFIG.HOST}\ndate: ${date}\nPOST ${XF_CONFIG.API_PATH} HTTP/1.1`;
  const signature = crypto.createHmac('sha256', XF_CONFIG.API_SECRET)
    .update(signatureStr)
    .digest('base64');

  const authorizationOrigin = `api_key="${XF_CONFIG.API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString('base64');

  return { authorization, date };
}

// 创建或获取聊天会话
function getChatSession(sessionId) {
  if (!chatSessions.has(sessionId)) {
    chatSessions.set(sessionId, {
      messages: [],
      createdAt: new Date(),
      lastActive: new Date()
    });
  }
  return chatSessions.get(sessionId);
}

// 代理讯飞AI绘画API
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt, width = 512, height = 512, sessionId = crypto.randomUUID() } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // 获取或创建会话
    const session = getChatSession(sessionId);
    session.lastActive = new Date();

    // 添加用户消息到会话历史
    session.messages.push({
      role: 'user',
      content: prompt,
      timestamp: new Date()
    });

    // 生成签名
    const { authorization, date } = generateXfSignature();
    const url = `https://${XF_CONFIG.HOST}${XF_CONFIG.API_PATH}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${XF_CONFIG.HOST}`;

    // 构建请求数据
    const requestData = {
      header: {
        app_id: XF_CONFIG.APP_ID
      },
      parameter: {
        chat: {
          domain: "general",
          width: parseInt(width),
          height: parseInt(height)
        }
      },
      payload: {
        message: {
          text: [
            {
              role: "user",
              content: prompt
            }
          ]
        }
      }
    };

    // 调用讯飞API
    const response = await axios.post(
      url,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Host': XF_CONFIG.HOST
        }
      }
    );

    // 添加AI响应到会话历史
    if (response.data.payload?.choices?.text?.[0]?.content) {
      session.messages.push({
        role: 'assistant',
        content: response.data.payload.choices.text[0].content,
        timestamp: new Date(),
        image: true
      });
    }

    res.json({
      ...response.data,
      sessionId,
      chatHistory: session.messages
    });
  } catch (error) {
    console.error('Error calling XF API:', error.message);
    res.status(500).json({
      error: 'Failed to generate image',
      details: error.response?.data || error.message
    });
  }
});

// 获取聊天历史
app.get('/api/chat-history/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = chatSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    sessionId,
    messages: session.messages,
    createdAt: session.createdAt,
    lastActive: session.lastActive
  });
});

// 所有路由都返回前端应用
// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, 'public', 'index.html'));
// });

// 启动服务器
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});