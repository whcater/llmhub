// Cloudflare Workers compatible logger using KV storage

/**
 * Convert Date to Shanghai timezone string (UTC+8)
 * Format: YYYY-MM-DD HH:mm:ss.SSS
 */
function toShanghaiTime(date: Date): string {
  // Add 8 hours for Shanghai timezone
  const shanghaiTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  
  const year = shanghaiTime.getUTCFullYear();
  const month = String(shanghaiTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shanghaiTime.getUTCDate()).padStart(2, '0');
  const hour = String(shanghaiTime.getUTCHours()).padStart(2, '0');
  const minute = String(shanghaiTime.getUTCMinutes()).padStart(2, '0');
  const second = String(shanghaiTime.getUTCSeconds()).padStart(2, '0');
  const ms = String(shanghaiTime.getUTCMilliseconds()).padStart(3, '0');
  
  return `${year}-${month}-${day} ${hour}:${minute}:${second}.${ms}`;
}

export interface RequestLogData {
  timestamp: string; // Shanghai time: YYYY-MM-DD HH:mm:ss.SSS
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: any;
  query?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string; // Optional: will be auto-generated if not provided
}

export interface ResponseLogData {
  timestamp: string; // Shanghai time: YYYY-MM-DD HH:mm:ss.SSS
  status: number;
  responseTime: number;
  body?: any;
  headers?: Record<string, string>;
  error?: string;
  requestId?: string; // Optional: used to correlate with request
}

export interface GeneralLogData {
  timestamp: string; // Shanghai time: YYYY-MM-DD HH:mm:ss.SSS
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: any;
}

/**
 * Get log folder name based on current time
 * Format: YYYY-MM-DD-HH
 */
function getLogFolderName(date?: Date): string {
  const now = date || new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');

  return `${year}-${month}-${day}-${hour}`;
}

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${timestamp}-${random}`;
}





/**
 * Write request log to KV
 * Key format: logs/{YYYY-MM-DD-HH}/{requestId}_req
 * Returns: requestId for correlating with response
 */
export async function writeRequestLog(kv: KVNamespace, data: RequestLogData): Promise<string> {
  try {
    const timestamp = new Date(data.timestamp);
    const folderName = getLogFolderName(timestamp);
    const requestId = data.requestId || generateRequestId();

    const key = `logs/${folderName}/${requestId}_req`;
    console.log(`[logger] writeRequestLog → key=${key}`);

    // Convert timestamp to Shanghai time before saving
    const logData = {
      ...data,
      timestamp: toShanghaiTime(timestamp),
    };

    const content = JSON.stringify(logData, null, 2);

    await kv.put(key, content);
    console.log(`[logger] writeRequestLog ✓ ${key} (${content.length}B)`);

    return requestId;
  } catch (error) {
    console.error('Failed to write request log:', error);
    return '';
  }
}

/**
 * Write response log to KV
 * Key format: logs/{YYYY-MM-DD-HH}/{requestId}_res
 * Returns: requestId for reference
 */
export async function writeResponseLog(kv: KVNamespace, data: ResponseLogData): Promise<string> {
  try {
    const timestamp = new Date(data.timestamp);
    const folderName = getLogFolderName(timestamp);
    const requestId = data.requestId || generateRequestId();

    const key = `logs/${folderName}/${requestId}_res`;
    console.log(`[logger] writeResponseLog → key=${key} status=${data.status}`);

    // Convert timestamp to Shanghai time before saving
    const logData = {
      ...data,
      timestamp: toShanghaiTime(timestamp),
    };

    const content = JSON.stringify(logData, null, 2);

    await kv.put(key, content);
    console.log(`[logger] writeResponseLog ✓ ${key} (${content.length}B)`);

    return requestId;
  } catch (error) {
    console.error('Failed to write response log:', error);
    return '';
  }
}

/**
 * Write general log to KV
 * Key format: logs/{YYYY-MM-DD-HH}/{MM}.log
 */
export async function writeGeneralLog(kv: KVNamespace, data: GeneralLogData): Promise<string> {
  try {
    const timestamp = new Date(data.timestamp);
    const folderName = getLogFolderName(timestamp);
    const minute = String(timestamp.getMinutes()).padStart(2, '0');

    const key = `logs/${folderName}/${minute}.log`;
    
    // Convert timestamp to Shanghai time for display
    const shanghaiTimeStr = toShanghaiTime(timestamp);
    
    const logLine = `[${shanghaiTimeStr}] [${data.level.toUpperCase()}] ${data.message}${
      data.data ? '\n' + JSON.stringify(data.data, null, 2) : ''
    }\n${'='.repeat(80)}\n`;

    // Append to existing log
    const existing = await kv.get(key) || '';
    await kv.put(key, existing + logLine);

    return key;
  } catch (error) {
    console.error('Failed to write general log:', error);
    return '';
  }
}

/**
 * Legacy function for backward compatibility
 * Now writes as general log
 */
export interface RequestLogEntry {
  timestamp: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: any;
  query?: string;
  ip?: string;
  userAgent?: string;
  responseStatus?: number;
  responseTime?: number;
  responseBody?: any;
  error?: string;
}

export async function writeLog(kv: KVNamespace, entry: RequestLogEntry): Promise<void> {
  const generalLogData: GeneralLogData = {
    timestamp: entry.timestamp,
    level: entry.error ? 'error' : 'info',
    message: `${entry.method} ${entry.path} - Status: ${entry.responseStatus || 'N/A'} - Time: ${entry.responseTime || 0}ms`,
    data: entry,
  };

  await writeGeneralLog(kv, generalLogData);
}

/**
 * Clean up logs older than the specified number of days
 * Folder format: YYYY-MM-DD-HH
 * Returns the number of deleted keys
 */
export async function cleanupOldLogs(kv: KVNamespace, retentionDays: number = 3): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffFolder = getLogFolderName(cutoff);

  let deleted = 0;
  let cursor: string | undefined;

  do {
    const list = await kv.list({ prefix: "logs/", cursor });
    for (const key of list.keys) {
      const match = key.name.match(/^logs\/([^/]+)\//);
      if (match && match[1] < cutoffFolder) {
        await kv.delete(key.name);
        deleted++;
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  return deleted;
}

/**
 * Get current log key path
 */
export function getCurrentLogFilePath(): string {
  const folderName = getLogFolderName();
  const minute = String(new Date().getMinutes()).padStart(2, '0');
  return `logs/${folderName}/${minute}.log`;
}

export interface ParsedStreamLog {
  text: string;
  events: number;
  stopReason?: string;
  usage?: any;
  toolUse?: any[];
}

/**
 * Consume an SSE stream and assemble a human-readable summary.
 * Supports Anthropic / OpenAI / Gemini delta formats.
 * Safe to call with any stream — unknown payloads are ignored.
 */
export async function parseSSEStreamForLog(stream: ReadableStream<Uint8Array>): Promise<ParsedStreamLog> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let events = 0;
  let stopReason: string | undefined;
  let usage: any;
  const toolUse: any[] = [];

  const processEvent = (rawEvent: string) => {
    events++;
    for (const line of rawEvent.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let evt: any;
      try { evt = JSON.parse(payload); } catch { continue; }

      // Anthropic
      if (evt.type === 'content_block_delta') {
        if (evt.delta?.type === 'text_delta' && typeof evt.delta.text === 'string') text += evt.delta.text;
        if (evt.delta?.type === 'input_json_delta' && typeof evt.delta.partial_json === 'string') {
          const idx = evt.index ?? 0;
          toolUse[idx] = toolUse[idx] || { partial_json: '' };
          toolUse[idx].partial_json += evt.delta.partial_json;
        }
      } else if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
        const idx = evt.index ?? toolUse.length;
        toolUse[idx] = { name: evt.content_block.name, id: evt.content_block.id, partial_json: '' };
      } else if (evt.type === 'message_delta') {
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
        if (evt.usage) usage = { ...(usage || {}), ...evt.usage };
      } else if (evt.type === 'message_start' && evt.message?.usage) {
        usage = { ...(usage || {}), ...evt.message.usage };
      }

      // OpenAI / Grok (OpenAI-compatible)
      const choice = evt.choices?.[0];
      if (choice) {
        if (typeof choice.delta?.content === 'string') text += choice.delta.content;
        if (choice.finish_reason) stopReason = choice.finish_reason;
        if (Array.isArray(choice.delta?.tool_calls)) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index ?? toolUse.length;
            toolUse[idx] = toolUse[idx] || { name: '', arguments: '' };
            if (tc.function?.name) toolUse[idx].name += tc.function.name;
            if (tc.function?.arguments) toolUse[idx].arguments += tc.function.arguments;
          }
        }
      }
      if (evt.usage) usage = evt.usage;

      // Gemini
      const parts = evt.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          if (typeof p.text === 'string') text += p.text;
        }
      }
      if (evt.candidates?.[0]?.finishReason) stopReason = evt.candidates[0].finishReason;
      if (evt.usageMetadata) usage = evt.usageMetadata;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        processEvent(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    }
    if (buffer.trim()) processEvent(buffer);
  } catch (err) {
    // Stream aborted or errored — return whatever we collected
  }

  const result: ParsedStreamLog = { text, events };
  if (stopReason) result.stopReason = stopReason;
  if (usage) result.usage = usage;
  if (toolUse.length) result.toolUse = toolUse.filter(Boolean);
  return result;
}
