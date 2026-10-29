import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  @ApiProperty({ enum: ['ok', 'degraded', 'down'] })
  status: 'ok' | 'degraded' | 'down';

  @ApiProperty({ enum: ['up', 'down'] })
  mongo: 'up' | 'down';

  @ApiProperty({ enum: ['up', 'down', 'disabled'] })
  worker: 'up' | 'down' | 'disabled';

  @ApiProperty()
  pending: number;

  @ApiProperty()
  processing: number;

  @ApiProperty()
  processed: number;

  @ApiProperty()
  failed: number;

  @ApiProperty({ nullable: true })
  oldestPendingAgeMs: number | null;
}
