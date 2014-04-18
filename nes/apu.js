var NES = NES || {};

// Note throughout that the raw period is stored, and the period counters count up from -1,
// in order to correctly (I hope) emulate the (period + 1) effective period.
NES.APU = function(Callbacks)
{
	var Self = this;

	Callbacks = Callbacks || {};
	var DisableAPUIRQ = false;
	var FrameInterrupt = false
	var Square1 = new NES.APU.SquareWave();
	var Square2 = new NES.APU.SquareWave();
	var Triangle = new NES.APU.TriangleWave();
	var Noise = new NES.APU.NoiseChannel();
	var DMC = new NES.APU.DMCChannel(Callbacks.ReadByte, Callbacks.RaiseInterrupt);

	var SequencerMode = 0; // 4 or 5.
	var SequencerIndex = 0; // Indicates which step of SequencerFrames we're waiting to encounter.
	var SequencerCounter = 0; // Counts up through the frames listed in SequencerFrames.
	var SequencerFrames = [ 3728, 7456, 11185, 14914, 18640 ]; // Per http://forums.nesdev.com/viewtopic.php?f=3&t=9011

	// I interpret the mixer formulas given on http://wiki.nesdev.com/w/index.php/APU_Mixer as approximations to nice hexadecimal numbers.
	// Pulse output = 0x6000 / (0x60 + 0x2000/(p1 + p2)) = 256 / (1 + 85/(p1 + p2)).
	// Other output = 0xA000 / (0x60 + 1/(t/0x2000 + n/0x3000 + d/0x6000)) = 426 / (1 + 256/(d + 2n + 3t)).
	// These lookup tables were generated in Mathematica by rounding those guesses.
	var PulseLookup = [ 0, 3, 6, 9, 12, 14, 17, 19, 22, 25, 27, 29, 32, 34, 36, 38, 41, 43, 45, 47, 49, 51, 53, 55, 56, 58, 60, 62, 63, 65, 67 ];
	var OtherLookup = [ 0, 2, 3, 5, 7, 8, 10, 11, 13, 14, 16, 18, 19, 21, 22, 24, 25, 27, 28, 29, 31, 32, 34, 35, 37, 38, 39, 41, 42, 43, 45, 46, 47, 49, 50, 51, 53, 54, 55, 56, 58, 59, 60, 61, 62, 64, 65, 66, 67, 68, 70, 71, 72, 73, 74, 75, 76, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 94, 95, 96, 97, 98, 99, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 114, 115, 116, 117, 118, 119, 120, 121, 121, 122, 123, 124, 125, 126, 126, 127, 128, 129, 130, 130, 131, 132, 133, 134, 134, 135, 136, 137, 137, 138, 139, 140, 141, 141, 142, 143, 143, 144, 145, 146, 146, 147, 148, 149, 149, 150, 151, 151, 152, 153, 153, 154, 155, 155, 156, 157, 157, 158, 159, 159, 160, 161, 161, 162, 163, 163, 164, 164, 165, 166, 166, 167, 168, 168, 169, 169, 170, 171, 171, 172, 172, 173, 174, 174, 175, 175, 176, 176, 177, 178, 178, 179, 179, 180, 180, 181, 181, 182, 183, 183, 184, 184, 185, 185, 186, 186, 187, 187, 188 ];

	Self.Output = function()
	{
		return PulseLookup[Square1.Output() + Square2.Output()] + OtherLookup[DMC.Output() + 2 * Noise.Output() + 3 * Triangle.Output()];
	}

	// Tick() is called every other CPU cycle, because, best as I can tell, every APU component ignores every other
	// cycle. That is, the APU is actually ticked every CPU cycle but the components only respond every other CPU cycle.
	Self.Tick = function()
	{
		Square1.Tick();
		Square2.Tick();
		Triangle.Tick();
		Noise.Tick();

		if (SequencerMode == 0) return;

		++SequencerCounter;
		if (SequencerCounter == SequencerFrames[SequencerIndex])
		{
			if (SequencerMode == 4)
			{
				Square1.EnvelopeTick();
				Square2.EnvelopeTick();
				Triangle.LinearCounterTick();
				Noise.EnvelopeTick();

				switch (SequencerIndex)
				{
					case 1:
						Square1.LengthCounterTick();
						Square2.LengthCounterTick();
						Square1.SweepTick(true);
						Square2.SweepTick(false);
						Noise.LengthCounterTick();
						break;

					case 3:
						Square1.LengthCounterTick();
						Square2.LengthCounterTick();
						Square1.SweepTick(true);
						Square2.SweepTick(false);
						Noise.LengthCounterTick();
						if (!DisableAPUIRQ)
						{
							throw "APU sequencer wants to raise IRQ.";
							// TODO: raise IRQ
						}
						break;
				}
			}
			else if (SequencerMode == 5 && SequencerIndex < 4)
			{
				Square1.EnvelopeTick();
				Square2.EnvelopeTick();
				Triangle.LinearCounterTick();
				Noise.EnvelopeTick();

				switch (SequencerIndex)
				{
					case 0:
						Square1.LengthCounterTick();
						Square2.LengthCounterTick();
						Square1.SweepTick(true);
						Square2.SweepTick(false);
						Noise.LengthCounterTick();
						break;

					case 2:
						Square1.LengthCounterTick();
						Square2.LengthCounterTick();
						Square1.SweepTick(true);
						Square2.SweepTick(false);
						Noise.LengthCounterTick();
						break;
				}
			}

			++SequencerIndex;
			if (SequencerIndex == SequencerMode) // 4 or 5
			{
				SequencerIndex = 0;
				SequencerCounter = 0;
			}
		}
	}

	Self.WriteRegister = function(Address, Value)
	{
		if (Address < 0x4000 || Address >= 0x4018)
			throw "Illegal call to APU::WriteRegister on $" + Address.toString(16);

		switch (Address)
		{
			case 0x4017:
				DisableAPUIRQ = (Value & 0x40) != 0;
				SequencerMode = ((Value & 0x80) == 0) ? 4 : 5;
				SequencerIndex = 0;
				if (SequencerMode == 4) SequencerCounter = 0;
				else if (SequencerMode == 5) SequencerCounter = SequencerFrames[0] - 1;
				break;

			case 0x4015:
				if ((Value & 0x01) == 0) Square1.Disable(); else Square1.Enable();
				if ((Value & 0x02) == 0) Square2.Disable(); else Square2.Enable();
				if ((Value & 0x04) == 0) Triangle.Disable(); else Triangle.Enable();
				if ((Value & 0x08) == 0) Noise.Disable(); else Noise.Enable();
				if ((Value & 0x10) == 0) DMC.ClearBytesRemaining(); else if (!DMC.NonzeroBytesRemaining()) DMC.RestartSample();
				DMC.ClearInterrupt();

				break;

			// Square 1
			case 0x4000:
				Square1.SetDutyCycle(Value);
				Square1.SetEnvelope(Value);
				break;

			case 0x4001:
				Square1.InitializeSweep(Value);
				break;

			case 0x4002:
				Square1.SetPeriodLow(Value);
				break;

			case 0x4003:
				Square1.SetPeriodHigh(Value);
				Square1.ReloadLengthCounter(Value);
				Square1.RestartEnvelope();
				break;

			// Square 2
			case 0x4004:
				Square2.SetDutyCycle(Value);
				Square2.SetEnvelope(Value);
				break;

			case 0x4005:
				Square2.InitializeSweep(Value);
				break;

			case 0x4006:
				Square2.SetPeriodLow(Value);
				break;

			case 0x4007:
				Square2.SetPeriodHigh(Value);
				Square2.ReloadLengthCounter(Value);
				Square2.RestartEnvelope();
				break;

			// Triangle
			case 0x4008:
				if ((Value & 0x80) != 0) Triangle.HaltLengthCounter();
				else Triangle.ResumeLengthCounter();
				Triangle.SetLinearCounterReload(Value);
				break;

			case 0x400A:
				Triangle.SetPeriodLow(Value);
				break;

			case 0x400B:
				Triangle.SetPeriodHigh(Value);
				Triangle.ReloadLengthCounter(Value);
				Triangle.HaltLinearCounter();
				break;

			// Noise
			case 0x400C:
				Noise.SetEnvelope(Value);
				break;

			case 0x400E:
				Noise.Initialize(Value);
				break;

			case 0x400F:
				Noise.ReloadLengthCounter(Value);
				break;

			// DMC
			case 0x4010:
				DMC.Initialize(Value);
				break;

			case 0x4011:
				DMC.DirectLoad(Value);
				break;

			case 0x4012:
				DMC.SetSampleAddress(Value);
				break;

			case 0x4013:
				DMC.SetSampleLength(Value);
				break;

			default:
				//Console.WriteLine("APU::WriteRegister on $" + AbsoluteAddress.ToString("X4") + ": Value = 0x" + Value.ToString("X2"));
				break;
		}
	}

	Self.ReadRegister = function(Address)
	{
		if (Address != 0x4015)
			throw "Illegal call to APU::ReadRegister on $" + AbsoluteAddress.toString(16);

		var Status = ((DMC.Interrupt() ? 0x80 : 0) | (FrameInterrupt ? 0x40 : 0) | (DMC.NonzeroBytesRemaining() ? 0x10 : 0) | (Noise.NonzeroCounter() ? 0x08 : 0) | (Triangle.NonzeroCounter() ? 0x04 : 0) | (Square2.NonzeroCounter() ? 0x02 : 0) | (Square1.NonzeroCounter() ? 0x01 : 0)) & 0xFF;
		FrameInterrupt = false;
		return Status;
	}

}

NES.APU.LengthCounterChannel = function()
{
	var Self = this;
	Self.Period = 0;
	Self.PeriodCounter = -1;
	Self.WaveFormCounter = 0;

	Self.Halted = false;
	Self.Enabled = true;
	Self.LengthCounter = 0;
	var LengthLookup =
	[
		0x0A, 0xFE, 0x14, 0x02, 0x28, 0x04, 0x50, 0x06, 0xA0, 0x08, 0x3C, 0x0A, 0x0E, 0x0C, 0x1A, 0x0E,
		0x0C, 0x10, 0x18, 0x12, 0x30, 0x14, 0x60, 0x16, 0xC0, 0x18, 0x48, 0x1A, 0x10, 0x1C, 0x20, 0x1E
	];

	Self.HaltLengthCounter = function() { Self.Halted = true; }
	Self.ResumeLengthCounter = function() { Self.Halted = false; }

	Self.LengthCounterTick = function()
	{
		if (Self.LengthCounter > 0 && !Self.Halted)
			--Self.LengthCounter;
	}

	Self.ReloadLengthCounter = function(Value)
	{
		if (!Self.Enabled) return;
		Self.LengthCounter = LengthLookup[(Value >> 3) & 0x1F];
	}

	Self.SetPeriodLow = function(P)
	{
		Self.Period &= ~0xFF;
		Self.Period |= (P & 0xFF);
	}

	Self.SetPeriodHigh = function(P)
	{
		Self.Period &= 0xFF;
		Self.Period |= ((P & 7) << 8);
		// apu_ref.txt, line 418.
		Self.PeriodCounter = -1;
		Self.WaveFormCounter = 0;
	}

	// Disabled is as if the length counter always has a value of zero. However, it doesn't actually change the
	// value of the length counter (2A03 technical reference.txt, line 930).
	// Yes it does set the length counter to zero (http://wiki.nesdev.com/w/index.php/APU_Length_Counter).
	// Not setting the length counter to zero causes the bad sweeps in SMB level 1-2.
	Self.Disable = function() { Self.Enabled = false; Self.LengthCounter = 0; }
	Self.Enable = function() { Self.Enabled = true; }

	Self.NonzeroCounter = function() { return Self.LengthCounter > 0; }
}

NES.APU.EnvelopeChannel = function()
{
	var Self = this;
	NES.APU.LengthCounterChannel.apply(Self); // Inherit from LengthCounterChannel.

	var Enveloped = false;
	var EnvelopeLoop = false;
	var EnvelopePeriod = 0;
	var EnvelopeCounter = -1;
	Self.EnvelopeVolume = 0;

	Self.EnvelopeTick = function()
	{
		if (!Enveloped) return;

		++EnvelopeCounter;
		if (EnvelopeCounter == EnvelopePeriod)
		{
			EnvelopeCounter = -1;
			if (Self.EnvelopeVolume > 0)
				--Self.EnvelopeVolume;
			else if (Self.EnvelopeVolume == 0 && EnvelopeLoop)
				Self.EnvelopeVolume = 0x0F;
		}
	}

	// Invoked when register 0 ($4000, $4004, $400C) written to.
	Self.SetEnvelope = function(Value)
	{
		Enveloped = (Value & 0x10) == 0;
		if (Enveloped)
		{
			Self.EnvelopeVolume = 0x0F;
			EnvelopePeriod = (Value & 0x0F) + 1;
			EnvelopeLoop = (Value & 0x20) != 0;
		}
		else
			Self.EnvelopeVolume = Value & 0x0F;

		if ((Value & 0x20) != 0) Self.HaltLengthCounter();
		else Self.ResumeLengthCounter();
	}

	// Invoked when register 3 ($4003, $4007, $400F) written to.
	// See http://wiki.nesdev.com/w/index.php/APU_Envelope "the start flag is cleared, the counter is loaded with 15, and the divider's period is immediately reloaded."
	Self.RestartEnvelope = function()
	{
		EnvelopeCounter = -1;
		Self.EnvelopeVolume = 0x0F;
	}
}

NES.APU.SquareWave = function()
{
	var Self = this;
	NES.APU.EnvelopeChannel.apply(Self); // Inherit from EnvelopeChannel.

	var DutyCycle = null;
	var DutyCycleTypes =
	[
		[ 0, 1, 0, 0, 0, 0, 0, 0 ],
		[ 0, 1, 1, 0, 0, 0, 0, 0 ],
		[ 0, 1, 1, 1, 1, 0, 0, 0 ],
		[ 1, 0, 0, 1, 1, 1, 1, 1 ]
	];

	var Output;
	var SweepEnabled;
	var SweepPeriod;
	var SweepCounter = -1;
	var SweepShiftCount;
	var SweepPositive; // Increase period, i.e. reduce frequency.
	var SweepReload;
	var SweepSilence;

	Self.Output = function()
	{
		return (Self.Enabled && Self.Counter != 0 && !SweepSilence) ? Output : 0;
	}

	// Called every APU clock.
	Self.Tick = function()
	{
		++Self.PeriodCounter;
		// Once the timer period expires, go to the next step in the waveform.
		if (Self.PeriodCounter == Self.Period)
		{
			Self.PeriodCounter = -1;
			if (DutyCycle != null)
			{
				Output = Self.EnvelopeVolume * DutyCycle[Self.WaveFormCounter++];
				Self.WaveFormCounter &= 7;
			}
		}
	}

	Self.SetDutyCycle = function(Value)
	{
		DutyCycle = DutyCycleTypes[Value >> 6];
	}

	Self.InitializeSweep = function(Value)
	{
		SweepSilence = false;
		SweepEnabled = (Value & 0x80) != 0;
		if (!SweepEnabled) return;
		SweepReload = true;
		SweepPeriod = ((Value >> 4) & 7);
		SweepPositive = (Value & 0x08) == 0;
		SweepShiftCount = Value & 7;
		SweepCounter = -1;
	}

	// Called every ~60 Hz on alternate frames of the sequencer.
	// Channel1 argument because of different behavior for square 1 and square 2:
	// "For reasons unknown, pulse channel 1 hardwires its adder's carry input rather than using the state
	// of the negate flag, resulting in the subtraction operation adding the one's complement instead of the
	// expected two's complement (as pulse channel 2 does). As a result, a negative sweep on pulse channel 1
	// will subtract the shifted period value minus 1."
	Self.SweepTick = function(Channel1) // Channel1: boolean.
	{
		if (!SweepEnabled) return; // TODO: do counters change even when sweep disabled?

		++SweepCounter;
		if (SweepCounter == SweepPeriod)
		{
			SweepCounter = -1;
			var Offset = Self.Period >> SweepShiftCount;
			var NewPeriod;

			if (SweepPositive)
				NewPeriod = Self.Period + Offset;
			else
				NewPeriod = Self.Period - Offset - (Channel1 ? 1 : 0);

			if (Self.Period < 8 || NewPeriod > 0x07FF)
				SweepSilence = true;
			else
			{
				SweepSilence = false;
				Self.SetPeriodLow(NewPeriod & 0xFF);
				Self.SetPeriodHigh(((NewPeriod & 0x07FF) >> 8) & 0xFF);
			}
		}

		// http://wiki.nesdev.com/w/index.php/APU_Sweep
		// When clocked by the frame counter, the divider is first clocked and then if the reload flag is set, it is cleared and the divider is reloaded.
		if (SweepReload)
		{
			SweepCounter = -1;
			SweepReload = false;
		}
	}
}

NES.APU.TriangleWave = function()
{
	var Self = this;
	NES.APU.LengthCounterChannel.apply(Self); // Inherit from LengthCounterChannel.

	var Output;
	var LinearCounterReloadValue = 0;
	var LinearCounter = 0;
	var LinearCounterHalted = false;
	var TriangleWaveform =
	[
		15, 13, 11, 9, 7, 5, 3, 1,
		1, 3, 5, 7, 9, 11, 13, 15
	];

	Self.Output = function()
	{
		return (Self.Enabled && Self.Counter != 0 && LinearCounter != 0) ? Output : 0;
	}

	Self.Tick = function()
	{
		++Self.PeriodCounter;
		// Once the timer period expires, go to the next step in the waveform.
		if (Self.PeriodCounter == Self.Period)
		{
			Self.PeriodCounter = -1;
			if (LinearCounter != 0 && Self.LengthCounter != 0)
			{
				Output = TriangleWaveform[Self.WaveFormCounter++]; // TODO: volume, envelope, whatever.
				Self.WaveFormCounter &= 0xF;
			}
		}
	}

	Self.HaltLinearCounter = function() { LinearCounterHalted = true; }
	Self.ResumeLinearCounter = function() { LinearCounterHalted = false; }
	Self.SetLinearCounterReload = function(Value) { LinearCounterReloadValue = Value & 0x7F; }

	Self.LinearCounterTick = function()
	{
		if (LinearCounterHalted)
			LinearCounter = LinearCounterReloadValue;
		else if (LinearCounter > 0)
			--LinearCounter;

		// This is identical to the condition "control flag is clear", because they share bit $4008.7.
		if (!Self.Halted)
			LinearCounterHalted = false;
	}
}

NES.APU.NoiseChannel = function()
{
	var Self = this;
	NES.APU.EnvelopeChannel.apply(Self); // Inherit from EnvelopeChannel.

	var Output = 0;
	var Periods = [ 0x004, 0x008, 0x010, 0x020, 0x040, 0x060, 0x080, 0x0A0, 0x0CA, 0x0FE, 0x17C, 0x1FC, 0x2FA, 0x3F8, 0x7F2, 0xFE4 ];
	var ShiftRegister;
	var Mode;

	Self.Output = function()
	{
		return (Self.Enabled && Self.Counter) ? Output : 0;
	}

	Self.Tick = function()
	{
		++Self.PeriodCounter;
		// Once the timer period expires, go to the next step in the waveform.
		if (Self.PeriodCounter == Self.Period)
		{
			Self.PeriodCounter = -1;
			// Mode 0: exclusive or of pre-shifted bits 0 and 1.
			// Mode 1: exclusive or of pre-shifted bits 0 and 6.
			var EORBit = (Mode == 0 ? (ShiftRegister >> 1) : (ShiftRegister >> 6)) & 1;
			EORBit = (EORBit ^ ShiftRegister) & 1;
			ShiftRegister >>= 1;
			ShiftRegister |= (EORBit << 14);
			Output = (ShiftRegister & 1) == 0 ? Self.EnvelopeVolume : 0;
		}
	}

	// Invoked when $400E is written to.
	Self.Initialize = function(Value)
	{
		Self.Period = Periods[Value & 0x0F];
		Self.PeriodCounter = -1; // TODO should this one start from 0?
		Mode = Value >> 7;
		ShiftRegister = 1; // apu_ref.txt, line 532.
	}
}

NES.APU.DMCChannel = function(ReadByte, RaiseInterrupt)
{
	var Self = this;

	var Output = 0;
	// NTSC. See http://wiki.nesdev.com/w/index.php/APU_DMC.
	var Periods = [ 0x1AC, 0x17C, 0x154, 0x140, 0x11E, 0x0FE, 0x0E2, 0x0D6, 0x0BE, 0x0A0, 0x08E, 0x080, 0x06A, 0x054, 0x048, 0x036 ];
	// "_Interrupt" is the interrupt flag, set at certain intervals and forces Tick() to raise an interrupt until the flag is shut off.
	var IRQEnabled, Loop, Silence, Interrupt;
	var TimerPeriod, TimerPeriodCounter, OutputBitCounter;
	var SampleAddress, SampleAddressReloadValue, BytesRemaining, BytesRemainingReloadValue;
	var SampleBuffer, ShiftRegister;
	var SampleBufferEmpty = true;

	Self.Output = function() { return Output; }

	Self.Tick = function()
	{
		if (Interrupt) RaiseInterrupt(NES.InterruptType.IRQBRK);

		// Clock the timer.
		++TimerPeriodCounter;
		if (TimerPeriodCounter == TimerPeriod)
		{
			TimerPeriodCounter = 0;
			if (!Silence)
			{
				// http://wiki.nesdev.com/w/index.php/APU_DMC
				// Bit 0 of the shift register is applied to the counter (_Output) as follows:
				// If bit 0 is clear and the delta-counter (_Output) is greater than 1, the counter is decremented by 2;
				// Otherwise, if bit 0 is set and the delta-counter is less than 126, the counter is incremented by 2.
				if ((ShiftRegister & 1) == 0 && _Output > 1)
					_Output -= 2;
				else if ((ShiftRegister & 1) != 0 && _Output < 126)
					_Output += 2;
			}

			ShiftRegister >>= 1;

			++OutputBitCounter;
			if (OutputBitCounter == 8)
			{
				OutputBitCounter = 0;
				if (SampleBufferEmpty)
					Silence = true;
				else
				{
					Silence = false;
					ShiftRegister = SampleBuffer;
					SampleBufferEmpty = true;
				}
			}
		}

		// During playback, SampleBufferEmpty will be false most of the time, so ReadNextSampleByte won't be called.
		if (SampleBufferEmpty && BytesRemaining > 0)
			ReadNextSampleByte();
	}

	function ReadNextSampleByte()
	{
		if (SampleAddress > 0xFFFF) SampleAddress = 0x8000 + (SampleAddress & 0x7FFF);
		SampleBuffer = ReadByte(SampleAddress++);
		SampleBufferEmpty = false;
		// TODO: When the DMA reader accesses a byte of memory, the CPU is suspended for 4 clock cycles.
		// apu_ref.txt, line 611.
		--BytesRemaining;

		if (BytesRemaining == 0)
		{
			if (Loop)
			{
				SampleAddress = SampleAddressReloadValue;
				BytesRemaining = BytesRemainingReloadValue;
			}
			else if (IRQEnabled)
			{
				Interrupt = true;
			}
		}
	}

	// Invoked when register 0 ($4010) written to.
	Self.Initialize = function(Value)
	{
		IRQEnabled = (Value & 0x80) != 0;
		if (!IRQEnabled) Interrupt = false;
		Loop = (Value & 0x40) != 0;
		TimerPeriod = Periods[Value & 0x0F];
		TimerPeriodCounter = 0;
	}

	// Invoked when register 1 ($4011) written to.
	Self.DirectLoad = function(Value)
	{
		Output = Value & 0x7F; // Counter might be the same thing as Output?? TODO.
	}

	// Invoked when register 2 ($4012) written to.
	Self.SetSampleAddress = function(Value)
	{
		SampleAddressReloadValue = 0xC000 | (Value << 6);
		SampleAddress = SampleAddressReloadValue;
	}

	// Invoked when register 3 ($4013) written to.
	Self.SetSampleLength = function(Value)
	{
		BytesRemainingReloadValue = (Value << 4) | 1;
		BytesRemaining = BytesRemainingReloadValue;
	}

	// Invoked when a one is written to bit 4 of $4015 and BytesRemaining == 0.
	Self.RestartSample = function()
	{
		SampleAddress = SampleAddressReloadValue;
		BytesRemaining = BytesRemainingReloadValue;
	}

	// Invoked when a zero is written to bit 4 of $4015.
	Self.ClearBytesRemaining = function()
	{
		BytesRemaining = 0;
	}

	Self.NonzeroBytesRemaining = function() { return BytesRemaining > 0; }
	Self.Interrupt = function() { return Interrupt; }
	Self.ClearInterrupt = function() { Interrupt = false; }
}
