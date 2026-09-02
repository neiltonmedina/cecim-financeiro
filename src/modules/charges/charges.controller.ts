import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ChargeStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChargesService } from './charges.service';
import { CreateChargeDto } from './dto/create-charge.dto';
import { CreateBulkChargesDto } from './dto/create-bulk-charges.dto';
import { DispatchChargesDto } from './dto/dispatch-charges.dto';

@ApiTags('charges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('charges')
export class ChargesController {
  constructor(private readonly chargesService: ChargesService) {}

  @Post()
  create(@Body() dto: CreateChargeDto, @Req() req: any) {
    return this.chargesService.create(dto, req.user?.userId);
  }

  @Post('bulk')
  createBulk(@Body() dto: CreateBulkChargesDto, @Req() req: any) {
    return this.chargesService.createBulk(dto, req.user?.userId);
  }

  /** Emite/dispara a cobrança para os clientes selecionados via SMS, WhatsApp e E-mail. */
  @Post('dispatch')
  dispatch(@Body() dto: DispatchChargesDto) {
    return this.chargesService.dispatch(dto);
  }

  @Get()
  findAll(@Query('status') status?: ChargeStatus, @Query('clientId') clientId?: string) {
    return this.chargesService.findAll({ status, clientId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.chargesService.findOne(id);
  }

  @Patch(':id/paid')
  markAsPaid(@Param('id') id: string) {
    return this.chargesService.markAsPaid(id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.chargesService.cancel(id);
  }
}
