import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TicketService } from './ticket.service';

@Module({
  imports: [DatabaseModule],
  providers: [TicketService],
  exports: [TicketService],
})
export class TicketModule {}
