import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CreateEventDto } from './dto/create-event.dto.js';
import {
  AcceptedEventDto,
  EventViewDto,
  PatientTimelineDto,
} from './dto/event-response.dto.js';
import { AcceptEventsService } from './accept-events.service.js';
import { EventQueryService } from './event-query.service.js';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(
    private readonly intake: AcceptEventsService,
    private readonly queries: EventQueryService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Accept a patient event and return before processing finishes',
  })
  @ApiAcceptedResponse({ type: AcceptedEventDto })
  accept(@Body() dto: CreateEventDto): Promise<AcceptedEventDto> {
    return this.intake.accept(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one event and its outcome' })
  @ApiOkResponse({ type: EventViewDto })
  getById(@Param('id') id: string): Promise<EventViewDto> {
    return this.queries.getById(id);
  }
}

@ApiTags('patients')
@Controller('patients')
export class PatientsController {
  constructor(private readonly queries: EventQueryService) {}

  @Get(':patientId')
  @ApiOperation({ summary: 'Read a patient timeline ordered by event time' })
  @ApiOkResponse({ type: PatientTimelineDto })
  timeline(@Param('patientId') patientId: string): Promise<PatientTimelineDto> {
    return this.queries.timeline(patientId);
  }
}
