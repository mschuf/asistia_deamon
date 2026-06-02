import { Module } from '@nestjs/common';
import { EmailDaemonService } from './email-daemon.service';
import { TicketDecisionService } from './ticket-decision.service';
import { MicrosoftModule } from '../microsoft/microsoft.module';
import { GeminiModule } from '../gemini/gemini.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule, MicrosoftModule, GeminiModule],
  providers: [EmailDaemonService, TicketDecisionService],
  exports: [EmailDaemonService],
})
export class DaemonModule {}
