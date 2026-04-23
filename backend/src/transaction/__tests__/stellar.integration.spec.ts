import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { TransactionModule } from '../transaction.module';
import { ConfigModule } from '@nestjs/config';
import { Server, Keypair, TransactionBuilder, Networks, Operation, Asset } from 'stellar-sdk';

// NOTE: This test uses the public Horizon testnet and Friendbot. It may fail if network is unavailable.
describe('Stellar integration (testnet)', () => {
  let app: INestApplication;
  const horizon = 'https://horizon-testnet.stellar.org';
  const server = new Server(horizon);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env.test' }), TransactionModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('creates an account, does a payment, and verifies tx on chain', async () => {
    // create source and destination
    const source = Keypair.random();
    const dest = Keypair.random();

    // fund source via friendbot
    const fbRes = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(source.publicKey())}`);
    expect(fbRes.ok).toBeTruthy();

    // fund dest
    const fbRes2 = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(dest.publicKey())}`);
    expect(fbRes2.ok).toBeTruthy();

    // load account
    const account = await server.loadAccount(source.publicKey());

    // build and submit payment tx
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: dest.publicKey(), asset: Asset.native(), amount: '1' }))
      .setTimeout(30)
      .build();

    tx.sign(source);

    const submit = await server.submitTransaction(tx);
    expect(submit.hash).toBeDefined();

    // call API
    const res = await request(app.getHttpServer()).get(`/transaction/verify/${submit.hash}`).expect(200);
    expect(res.body.ok).toBeTruthy();
    expect(res.body.tx).toBeDefined();
    expect(res.body.operations).toBeDefined();
  }, 60000);
});
