import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export const MCP_URL = `${location.origin}/mcp`;

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256Hex(s: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Creates an API token for the MCP server. Only its hash is stored, so the token is returned once. */
export async function createToken(me: string, name: string) {
  const token = `hyp_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  await setDoc(doc(db, 'apiTokens', await sha256Hex(token)), {
    email: me,
    name,
    createdAt: serverTimestamp(),
    lastUsedAt: null,
  });
  return token;
}
