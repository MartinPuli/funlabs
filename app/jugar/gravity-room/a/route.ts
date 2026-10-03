import { GRAVITY_ROOM_A_HTML, GRAVITY_ROOM_A_SHA256 } from '@/lib/game/builds.generated';
import { gameResponse } from '@/lib/http/game';

/** Version A as committed in the repository (games/gravity-room/a). */
export function GET() {
  return gameResponse(GRAVITY_ROOM_A_HTML, { immutable: true, sha256: GRAVITY_ROOM_A_SHA256 });
}
