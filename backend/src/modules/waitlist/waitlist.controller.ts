import { Controller, Post, Body, Get, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { WaitlistService } from './waitlist.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Post('join')
  async join(@Body() body: { email: string; name?: string }) {
    return this.waitlistService.join(body.email, body.name);
  }

  @Post('verify')
  async verifyEmail(@Body() body: { token: string }) {
    if (!body.token) {
      throw new BadRequestException('Verification token required');
    }
    await this.waitlistService.verifyEmail(body.token);
    return { success: true, message: 'Email verified successfully' };
  }

  @Get('status/:email')
  async getStatus(@Param('email') email: string) {
    const entry = await this.waitlistService.getStatusByEmail(email);
    if (!entry) {
      return { found: false };
    }
    return {
      found: true,
      email: entry.email,
      emailVerified: entry.emailVerified,
      status: entry.status,
      createdAt: entry.createdAt,
      notifiedAt: entry.notifiedAt,
    };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get()
  async findAll() {
    return this.waitlistService.findAll();
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('notify/:id')
  async notify(@Param('id') id: string) {
    return this.waitlistService.notifyUser(id);
  }
}
