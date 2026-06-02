import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { MicrosoftModule } from './microsoft/microsoft.module';
import { GeminiModule } from './gemini/gemini.module';
import { DaemonModule } from './daemon/daemon.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    MicrosoftModule,
    GeminiModule,
    DaemonModule,
  ],
})
export class AppModule {}
