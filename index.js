const REQUEST_COUNT = 10;
const BYTES_PER_MEGABYTE = 1_000_000;

async function main() {
  const input = process.argv[2];

  if (!input || process.argv.length !== 3) {
    throw new Error('Usage: node index.js <http-or-https-url>');
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

    let response;

    try {
      response = await fetch(target);
    } catch (error) {
      throw new Error(`Request ${requestNumber}/${REQUEST_COUNT} failed: ${error.message}`);
    }

    let responseBytes = 0;

    try {
      if (response.body) {
        for await (const chunk of response.body) {
          responseBytes += chunk.byteLength;
        }
      }
    } catch (error) {
      throw new Error(`Could not read response ${requestNumber}/${REQUEST_COUNT}: ${error.message}`);
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
