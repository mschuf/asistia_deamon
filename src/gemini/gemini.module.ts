import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { GeminiService } from './gemini.service';

@Module({
  imports: [DatabaseModule],
  providers: [GeminiService],
  exports: [GeminiService],
})
export class GeminiModule {}
