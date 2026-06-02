import { Module } from '@nestjs/common';
import { MicrosoftAuthService } from './microsoft-auth.service';
import { OutlookService } from './outlook.service';

@Module({
  providers: [MicrosoftAuthService, OutlookService],
  exports: [OutlookService],
})
export class MicrosoftModule {}
