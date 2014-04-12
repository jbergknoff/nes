var NES = NES || {};

// Callbacks: object with
//		DrawScreen: function() // TODO
//		PollInput: function() // TODO

// This is the class that connects all of the independent pieces of the system together:
// the CPU, PPU, APU, cartridge, etc.
NES.System = function(Callbacks)
{
	var Self = this;
	var RAM = new Uint8Array(0x800);
	var CPU = new NES.CPU({ "ReadByte": ReadByte, "WriteByte": WriteByte, "RaiseInterrupt": RaiseInterrupt });
	var PPU;
	var Cartridge;
	var PollInput = (Callbacks || {}).PollInput;

	var CurrentInterrupt = NES.InterruptType.None;
	var AdditionalCycles = 0; // For DMA, interrupt, etc.

	// ROMData is a Uint8Array (https://developer.mozilla.org/en-US/docs/Web/API/ArrayBufferView)
	Self.LoadCartridge = function(ROMData)
	{
		Cartridge = new NES.Cartridge(ROMData);
		if (!Cartridge.IsValid()) return console.log("rom not valid");

		// Read the 16 bit "reset vector" at 0xFFFC in order to know where to start executing game code.
		var StartingPC = (ReadByte(0xFFFD) << 8) | ReadByte(0xFFFC);
		console.log("starting program at " + StartingPC.toString(16));

		CPU.PC(StartingPC);

		var DC = document.getElementById("c").getContext("2d");
		// TODO: gross that this is here and not up there, but Cartridge.Mapper() isn't defined until now.
		PPU = new NES.PPU
		(
			{
				"ReadCHR": Cartridge.Mapper().ReadCHR,
				"WriteCHR": function() { throw "can't write to CHR"; },
				"RaiseInterrupt": RaiseInterrupt,
				"DrawScreen": function(Screen, FrameCounter)
				{
					var ID = DC.createImageData(256, 240);

					for (var i = 0; i < 256 * 240; i++)
					{
						ID.data[4 * i + 0] = NES.Colors[Screen[i]][0];
						ID.data[4 * i + 1] = NES.Colors[Screen[i]][1];
						ID.data[4 * i + 2] = NES.Colors[Screen[i]][2];
						ID.data[4 * i + 3] = 255;
					}

					//console.log("drawing frame %d", FrameCounter);
					DC.putImageData(ID, 0, 0);
				}
			}
		);

		PPU.SetMirroring(Cartridge.Mirroring());
	}

	Self.Disassemble = function() { return CPU.Disassemble(); };
	Self.CPUDetails = function() { return CPU.Details(); };

	var PPUCycleCounter = 0;
	Self.Step = function()
	{
		var CPUCycles = CPU.Step();

		PPUCycleCounter += CPUCycles * NES.CyclesPerCPUCycle + AdditionalCycles;
		while (PPUCycleCounter > NES.CyclesPerPixel)
		{
			PPU.Tick();
			PPUCycleCounter -= NES.CyclesPerPixel;
		}

		AdditionalCycles = 0;

		if (CurrentInterrupt != NES.InterruptType.None)
		{
			HandleInterrupt();
		}

		return CPU.PC();
	};

	Self.MemoryDump = function(Start, Length)
	{
		var Memory = [];
		for (var i = 0; i < Length; i++)
			Memory.push(ReadByte(Start + i));

		return Memory;
	};

	function ReadByte(Address)
	{
		Address &= 0xFFFF;

		if (Address < 0x2000)
			return RAM[Address & 0x7FF];
		else if (Address < 0x4000)
			return PPU.ReadRegister(Address);
		else if (Address < 0x6000)
		{
			if (Address == 0x4016) return PollInput() ? 1 : 0;
			if (Address == 0x4017) return 0;
			throw "APU/input register read " + Address.toString(16).substr(-4, 4);
		}
		else if (Address < 0x8000)
			throw "SRAM read";
		else
			return Cartridge.Mapper().ReadPRG(Address);
	}

	function WriteByte(Address, Value)
	{
		Address &= 0xFFFF;

		if (Address < 0x2000)
			RAM[Address & 0x7FF] = Value;
		else if (Address < 0x4000 || Address == 0x4014) // 0x4014 is DMA.
		{
			if (Address == 0x4014)
			{
				var Start = (Value & 7) * 0x100;
				PPU.DMA(RAM.subarray(Start, Start + 0x100));
				AdditionalCycles += 513 * NES.CyclesPerCPUCycle;
			}
			else
				PPU.WriteRegister(Address, Value);
		}
		else if (Address < 0x4018)
		{
			//console.log("APU register write to " + Address.toString(16).substr(-4, 4));
			return;
		}
		else if (Address >= 0x6000 && Address < 0x8000)
			throw "SRAM write";
		else if (Address >= 0x8000)
			throw "mapper register write";
		else
			throw "Don't know how to write to 0x" + Address.toString(16);
	}

	function RaiseInterrupt(InterruptType)
	{
		if (InterruptType == NES.InterruptType.CancelNMI && CurrentInterrupt == NES.InterruptType.NMI)
		{
			CurrentInterrupt = NES.InterruptType.None;
			return;
		}

		// Priorities: Reset > NMI > IRQ/BRK.
		if (InterruptType > CurrentInterrupt)
			CurrentInterrupt = InterruptType;
	}

	function HandleInterrupt()
	{
		switch (CurrentInterrupt)
		{
			case NES.InterruptType.NMI:
				CPU.PrepareInterrupt((ReadByte(0xFFFB) << 8) | ReadByte(0xFFFA));
				AdditionalCycles += 7 * NES.CyclesPerCPUCycle;
				break;

			case NES.InterruptType.IRQBRK:
				CPU.PrepareInterrupt((ReadByte(0xFFFF) << 8) | ReadByte(0xFFFE));
				break;
		}

		CurrentInterrupt = NES.InterruptType.None;
	}
};
