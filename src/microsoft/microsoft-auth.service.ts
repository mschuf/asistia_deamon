import { Injectable } from '@nestjs/common';
import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import 'isomorphic-fetch';
import { MicrosoftMailboxConfig } from './types';

@Injectable()
export class MicrosoftAuthService {
  private readonly scopes: string[] = ['https://graph.microsoft.com/.default'];

  getGraphClient(config: MicrosoftMailboxConfig): Client {
    const credential = new ClientSecretCredential(
      config.msTenantId,
      config.msClientId,
      config.msClientSecret,
    );

    return Client.init({
      authProvider: async (done) => {
        try {
          const token = await credential.getToken(this.scopes);
          if (!token) {
            return done(new Error('No se pudo obtener token'), null);
          }
          done(null, token.token);
        } catch (err) {
          done(err as Error, null);
        }
      },
    });
  }
}
