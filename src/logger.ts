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
    
    // Convert timestamp to Shanghai time before saving
    const logData = {
      ...data,
      timestamp: toShanghaiTime(timestamp),
    };
    
    const content = JSON.stringify(logData, null, 2);
    
    await kv.put(key, content);

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
    
    // Convert timestamp to Shanghai time before saving
    const logData = {
      ...data,
      timestamp: toShanghaiTime(timestamp),
    };
    
    const content = JSON.stringify(logData, null, 2);
    
    await kv.put(key, content);

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
 * Get current log key path
 */
export function getCurrentLogFilePath(): string {
  const folderName = getLogFolderName();
  const minute = String(new Date().getMinutes()).padStart(2, '0');
  return `logs/${folderName}/${minute}.log`;
}
