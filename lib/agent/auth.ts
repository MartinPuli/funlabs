import type { SupabaseClient } from '@supabase/supabase-js';
import type { Capability } from '../catalog.ts';
import { hashToken, looksLikeToken } from '../tokens.ts';

export class AgentError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type AgentCredential = {
  id: string;
  product_id: string;
  study_id: string | null;
  bounty_id: string | null;
  kind: 'creator_agent' | 'participant_agent';
  label: string;
  capabilities: Capability[];
  created_by: string;
  expires_at: string;
  labels_seen_at: string | null;
};

export type AgentActor = { credential: AgentCredential };

/**
 * A work credential limits actor, study, bounty, capabilities and lifetime.
 * Only its hash is stored. It is never an administrative key.
 */
export async function authenticateAgent(worker: SupabaseClient, token: string | null): Promise<AgentActor> {
  if (!token) throw new AgentError('missing_token', 'Falta la credencial de trabajo (Authorization: Bearer fla_...)', 401);
  if (!looksLikeToken(token, 'fla')) throw new AgentError('invalid_token', 'La credencial no tiene el formato esperado', 401);
  const { data, error } = await worker
    .from('agent_credentials')
    .select('id, product_id, study_id, bounty_id, kind, label, capabilities, created_by, expires_at, revoked_at, labels_seen_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (error) throw new Error(`Credencial: ${error.message}`);
  if (!data) throw new AgentError('invalid_token', 'Credencial desconocida', 401);
  if (data.revoked_at) throw new AgentError('revoked', 'La credencial fue revocada por su titular', 401);
  if (new Date(data.expires_at).getTime() < Date.now()) throw new AgentError('expired', 'La credencial venció', 401);
  void worker.from('agent_credentials').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => undefined);
  const { revoked_at: _revoked, ...credential } = data;
  void _revoked;
  return { credential: credential as AgentCredential };
}

export function requireCapability(actor: AgentActor, capability: Capability) {
  if (!actor.credential.capabilities.includes(capability)) {
    throw new AgentError('forbidden', `Esta credencial no tiene la capacidad ${capability}`, 403, { required: capability, granted: actor.credential.capabilities });
  }
}
