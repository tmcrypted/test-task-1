const REQUEST_COUNT = 10;
const BYTES_PER_MEGABYTE = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;

async function main() {
  const args = process.argv.slice(2);
  let input;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  if (args.length === 1) {
    [input] = args;
  } else if (args.length === 3 && args[0] === '--timeout-ms') {
    timeoutMs = Number(args[1]);
    input = args[2];

    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('--timeout-ms must be a positive integer.');
    }
  } else {
    throw new Error('Usage: node index.js [--timeout-ms <milliseconds>] <http-or-https-url>');
  }

  let target;

  try {
    target = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('URL must use the http: or https: protocol.');
  }

  let totalBytes = 0;
  let totalDurationMs = 0;

  for (let requestNumber = 1; requestNumber <= REQUEST_COUNT; requestNumber += 1) {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let responseBytes = 0;
    let phase = 'request';

    try {
      response = await fetch(target, { signal: controller.signal });
      phase = 'response body';

      if (response.body) {
        for await (const chunk of response.body) {
          responseBytes += chunk.byteLength;
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Request ${requestNumber}/${REQUEST_COUNT} timed out after ${timeoutMs} ms.`);
      }
      const description = phase === 'request' ? 'failed' : 'could not read response';
      throw new Error(`Request ${requestNumber}/${REQUEST_COUNT} ${description}: ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }

    const durationMs = performance.now() - startedAt;

    if (!response.ok) {
      throw new Error(
        `Request ${requestNumber}/${REQUEST_COUNT} returned HTTP ${response.status} ${response.statusText}.`,
      );
    }

    totalBytes += responseBytes;
    totalDurationMs += durationMs;
  }

  const averageDurationMs = totalDurationMs / REQUEST_COUNT;
  const totalDurationSeconds = totalDurationMs / 1_000;
  const downloadSpeedMBps = totalBytes / BYTES_PER_MEGABYTE / totalDurationSeconds;

  console.log(`Requests completed: ${REQUEST_COUNT}`);
  console.log(`Average request time: ${averageDurationMs.toFixed(2)} ms`);
  console.log(`Total response data: ${totalBytes} bytes (${(totalBytes / BYTES_PER_MEGABYTE).toFixed(2)} MB)`);
  console.log(`Average download speed: ${downloadSpeedMBps.toFixed(4)} MB/s`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
