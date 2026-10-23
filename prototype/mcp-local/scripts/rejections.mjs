import assert from 'node:assert/strict';
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/client';

function toolError(result) {
  assert.equal(result.isError, true, 'Expected an MCP tool error result');
  assert.equal(result.structuredContent, undefined, 'Error must not contain account data');
  assert.equal(result.content?.length, 1);
  assert.equal(result.content[0].type, 'text');
  assert.equal(typeof result.content[0].text, 'string');
  return result.content[0].text;
}

// Thrown transport/client/protocol errors cannot satisfy tool-result contracts.
export async function expectReadDenied(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(toolError(result), 'SYNTHETIC_READ_DENIED');
  return result;
}

export async function expectInvalidArguments(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const prefix = `Input validation error: Invalid arguments for tool ${name}: `;
  const message = toolError(result);
  assert.ok(message.startsWith(prefix) && message.length > prefix.length, 'Expected SDK input-schema rejection');
  return result;
}

export async function expectUnknownTool(client, name) {
  try { await client.callTool({ name, arguments: {} }); }
  catch (error) {
    // The pinned SDK reports __proto__ as disabled; both profiles must deny it.
    if (!(error instanceof ProtocolError)) throw error;
    assert.equal(error.code, ProtocolErrorCode.InvalidParams);
    assert.equal(error.data, undefined, 'Unknown-tool rejection must not expose data');
    assert.equal(error.message, `Tool ${name} ${name === '__proto__' ? 'disabled' : 'not found'}`);
    return { kind: 'protocol', code: error.code };
  }
  assert.fail('Expected a JSON-RPC error for an unknown tool');
}

export async function expectRpcError(response, { status, id, code, message }) {
  assert.equal(response.status, status);
  const media = response.headers.get('content-type')?.split(';')[0].trim();
  const text = await response.text(); // Broken body streams must fail the test.
  assert.ok(Buffer.byteLength(text) <= 16384);
  let json;
  if (media === 'application/json') json = JSON.parse(text);
  else {
    assert.equal(media, 'text/event-stream');
    const frames = text.replaceAll('\r\n', '\n').trim().split('\n\n');
    assert.equal(frames.length, 1);
    const lines = frames[0].split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0], 'event: message');
    assert.ok(lines[1].startsWith('data: '));
    json = JSON.parse(lines[1].slice(6));
  }
  assert.deepEqual(json, { jsonrpc: '2.0', id, error: { code, message } });
  return json;
}
