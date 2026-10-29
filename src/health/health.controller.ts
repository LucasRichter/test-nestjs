import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthDto } from './health.dto.js';
import { assertStoreAvailable, HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Mongo, worker, and backlog' })
  @ApiOkResponse({ type: HealthDto })
  async get(): Promise<HealthDto> {
    return assertStoreAvailable(await this.health.snapshot());
  }
}
