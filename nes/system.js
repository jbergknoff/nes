var NES = NES || {};

// Callbacks: object with
//		DrawScreen: function() // TODO
//		PollInput: function() // TODO

// This is the class that connects all of the independent pieces of the system together:
// the CPU, PPU, APU, cartridge, etc.
NES.System = function(Callbacks)
{
	var RAM = new Uint8Array(0x800);
	var Cartridge;

	// ROMData is a Uint8Array (https://developer.mozilla.org/en-US/docs/Web/API/ArrayBufferView)
	this.LoadCartridge = function(ROMData)
	{
		Cartridge = new NES.Cartridge(ROMData);
		if (!Cartridge.IsValid()) return console.log("rom not valid");

		// Read the 16 bit "reset vector" at 0xFFFC in order to know where to start executing game code.
		var StartingProgramCounter = (ReadByte(0xFFFD) << 8) | ReadByte(0xFFFC);
		console.log("starting program at " + StartingProgramCounter.toString(16));
	}

	function ReadByte(AbsoluteAddress)
	{
		AbsoluteAddress &= 0xFFFF;

		if (AbsoluteAddress < 0x2000)
			return RAM[AbsoluteAddress & 0x7FF];
		else if (AbsoluteAddress < 0x4000)
			throw "PPU register read";
		else if (AbsoluteAddress < 0x6000)
			throw "APU/input register read";
		else if (AbsoluteAddress < 0x8000)
			throw "SRAM read";
		else
			return Cartridge.Mapper().ReadPRG(AbsoluteAddress);
	}

	function WriteByte(AbsoluteAddress, Value)
	{
		AbsoluteAddress &= 0xFFFF;

		if (AbsoluteAddress < 0x2000)
			RAM[AbsoluteAddress & 0x7FF] = Value;
		else if (AbsoluteAddress < 0x4000 || AbsoluteAddress == 0x4014) // 0x4014 is DMA.
		{
			if (AbsoluteAddress == 0x4014)
				throw "DMA";
			else
				throw "PPU register write";
		}
		else if (AbsoluteAddress < 0x4018)
		{
			if (AbsoluteAddress == 0x4016) return;
			throw "APU register write";
		}
		else if (AbsoluteAddress >= 0x6000 && AbsoluteAddress < 0x8000)
			throw "SRAM write";
		else if (AbsoluteAddress >= 0x8000)
			throw "mapper register write";
		else
			throw "Don't know how to write to 0x" + AbsoluteAddress.toString(16);
	}
};
