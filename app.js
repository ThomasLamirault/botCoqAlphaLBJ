import 'dotenv/config';
import express from 'express';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { getRandomEmoji } from './utils.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (_, res) => res.sendStatus(204));

app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  const { type } = req.body;

  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name, data } = req.body;

    if (name === 'test') {
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: InteractionResponseFlags.EPHEMERAL,
          content: `hello world ${getRandomEmoji()}`
        }
      });
    }

    console.error(`unknown command: ${name || 'unknown'}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  return res.status(400).json({ error: 'unknown interaction type' });
});

app.listen(PORT, () => {
  console.log(`✅ Bot est en ligne sur le port ${PORT}`);
});
