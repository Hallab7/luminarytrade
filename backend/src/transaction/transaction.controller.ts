import { Controller, Get, Param } from '@nestjs/common';
import { StellarBridgeService } from './stellar-bridge.service';

@Controller('transaction')
export class TransactionController {
  constructor(private readonly stellar: StellarBridgeService) {}

  @Get('verify/:hash')
  async verify(@Param('hash') hash: string) {
    const res = await this.stellar.verifyTransaction(hash);
    if (!res.ok) {
      return { ok: false, error: res.error };
    }
    return { ok: true, tx: res.transaction, operations: res.operations };
  }
}
