import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsJsonObject } from './is-json-object.js';

export class CreateEventDto {
  @ApiProperty({ example: 'patient-1', maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  patientId: string;

  @ApiProperty({ example: 'vitals', maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  type: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { heartRate: 80 },
  })
  @IsJsonObject()
  data: Record<string, unknown>;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsISO8601({ strict: true })
  ts: string;
}
