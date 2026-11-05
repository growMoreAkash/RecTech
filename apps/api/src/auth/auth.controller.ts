import { Body, Controller, Get, Headers, HttpCode, Inject, Ip, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AuthTokens,
  loginSchema,
  type LoginInput,
  pinLoginSchema,
  type PinLoginInput,
  refreshSchema,
} from '@dinesense/shared';
import type { Request, Response } from 'express';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { RateLimitService } from '../common/rate-limit.service';
import { ENV, type Env } from '../config/env';
import { AuthService } from './auth.service';
import { Public } from './decorators';

export const REFRESH_COOKIE = 'ds_refresh';

@ApiTags('auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly limit: RateLimitService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  async login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Res({ passthrough: true }) res: Response) {
    return this.withCookie(res, await this.auth.login(body));
  }

  @Post('pin-login')
  @HttpCode(200)
  @ApiZodBody(pinLoginSchema)
  async pinLogin(
    @Headers('x-device-token') deviceToken: string | undefined,
    @Body(new ZodPipe(pinLoginSchema)) body: PinLoginInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.withCookie(res, await this.auth.pinLogin(deviceToken, body));
  }

  @Get('device-staff')
  async deviceStaff(@Headers('x-device-token') deviceToken: string | undefined, @Ip() ip: string) {
    await this.limit.hit(`device-staff:${ip}`, 30, 60);
    return this.auth.deviceStaff(deviceToken);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiZodBody(refreshSchema)
  async refresh(
    @Req() req: Request,
    @Body(new ZodPipe(refreshSchema)) body: { refreshToken?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.withCookie(res, await this.auth.refresh(body.refreshToken ?? this.cookie(req)));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Body(new ZodPipe(refreshSchema)) body: { refreshToken?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken ?? this.cookie(req));
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  private cookie(req: Request): string | undefined {
    const v = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
    return typeof v === 'string' ? v : undefined;
  }

  private withCookie(res: Response, tokens: AuthTokens): AuthTokens {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.NODE_ENV === 'production',
      path: '/api/v1/auth',
      maxAge: this.env.REFRESH_TTL_DAYS * 86_400_000,
    });
    return tokens;
  }
}
