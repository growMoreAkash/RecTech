import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../common/app-error';

/** Claims of a guest (QR) session. Separate issuer/audience: never accepted where a staff token is expected. */
export interface GuestClaims {
  sid: string; // GuestSession id
  seat: string; // Seating id
  out: string; // Outlet id
  org: string;
  tbl: string; // Table id the QR belongs to
}

export const GUEST_ISSUER = 'dinesense-guest';
const GUEST_AUDIENCE = 'guest';
/** A meal rarely lasts longer; the session also dies the moment the seating closes. */
const GUEST_TTL_SECONDS = 8 * 3600;

@Injectable()
export class GuestTokens {
  constructor(private readonly jwt: JwtService) {}

  sign(claims: GuestClaims): Promise<string> {
    return this.jwt.signAsync(
      { ...claims },
      { issuer: GUEST_ISSUER, audience: GUEST_AUDIENCE, expiresIn: GUEST_TTL_SECONDS },
    );
  }

  async verify(token: string | undefined): Promise<GuestClaims> {
    if (!token)
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'Scan the table QR code to continue');
    try {
      return await this.jwt.verifyAsync<GuestClaims>(token, {
        issuer: GUEST_ISSUER,
        audience: GUEST_AUDIENCE,
      });
    } catch {
      throw new AppError(
        'UNAUTHENTICATED',
        HttpStatus.UNAUTHORIZED,
        'Your table session has expired; scan the QR code again',
      );
    }
  }
}
