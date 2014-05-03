importScripts("./constants.js");
importScripts("./cpu.js");
importScripts("./ppu.js");
importScripts("./apu.js");
importScripts("./cartridge.js");
importScripts("./mapper.js");

onmessage = function(E)
{
	var Message = E.data || {};

	switch (Message.Type)
	{
		case "Cartridge":
			LoadCartridge(Message.Data);
			break;

		case "Run":
			//console.log(Message.Milliseconds);
			Run();
			break;

		case "Input":
			Controllers[~~Message.Controller - 1].ButtonState = Message.ButtonState;
			break;
	}
};

// This is the class that connects all of the independent pieces of the system together:
// the CPU, PPU, APU, cartridge, etc.
var RAM = new Uint8Array(0x800);
var CPU = new NES.CPU({ "ReadByte": ReadByte, "WriteByte": WriteByte, "RaiseInterrupt": RaiseInterrupt });
var APU = new NES.APU({ "ReadByte": ReadByte, "RaiseInterrupt": RaiseInterrupt });
var PPU = new NES.PPU
(
	{
		"GetMapper": function() { return Cartridge.Mapper(); },
		"RaiseInterrupt": RaiseInterrupt,
		"DrawScreen": function(Screen, FrameCounter)
		{
			postMessage({ "Type": "Screen", "Data": Screen });
		}
	}
);

var Cartridge;

var CurrentInterrupt = NES.InterruptType.None;
var AdditionalCycles = 0; // For DMA, interrupt, etc.

var Controllers = [];
Controllers[0] =
{
	"ButtonState": [],
	"Counter": 0
};

// ROMData is a Uint8Array (https://developer.mozilla.org/en-US/docs/Web/API/ArrayBufferView)
function LoadCartridge(ROMData)
{
	Cartridge = new NES.Cartridge(ROMData);
	if (!Cartridge.IsValid())
	{
		postMessage({ "Type": "Log", "Data": "rom not valid" });
		return;
	}

	// Read the 16 bit "reset vector" at 0xFFFC in order to know where to start executing game code.
	var StartingPC = (ReadByte(0xFFFD) << 8) | ReadByte(0xFFFC);
	postMessage({ "Type": "Log", "Data": "starting program at " + StartingPC.toString(16) });

	CPU.PC(StartingPC);
	postMessage({ "Type": "Ready" });
}

/*
Self.Disassemble = function() { return CPU.Disassemble(); };
Self.CPUDetails = function() { return CPU.Details(); };
*/

var PPUCycleCounter = 0;
var APUCycleCounter = 0;
var AudioSampleCycleCounter = 0;

var AudioBuffer = [];
function Step()
{
	var CPUCycles = CPU.Step();
	var CyclesToRun = CPUCycles * NES.CyclesPerCPUCycle + AdditionalCycles;

	PPUCycleCounter += CyclesToRun;
	while (PPUCycleCounter > NES.CyclesPerPixel)
	{
		PPU.Tick();
		PPUCycleCounter -= NES.CyclesPerPixel;
	}

	// APU catch-up loop. Ticks APU every CyclesPerAPUCycle. On real NES, the APU is being ticked every
	// CPU cycle, but all APU components (except triangle linear counter) ignore every other tick.
	// Therefore, save ourselves the trouble and tick APU only once per two CPU cycles.
	APUCycleCounter += CyclesToRun;
	while (APUCycleCounter >= NES.CyclesPerAPUCycle)
	{
		APU.Tick();
		APUCycleCounter -= NES.CyclesPerAPUCycle;
	}

	AudioSampleCycleCounter += CyclesToRun;
	while (AudioSampleCycleCounter >= NES.CyclesPerAudioSample)
	{
		AudioBuffer.push((APU.Output() / 128) - 1);

		// (1/60) second * 44100 samples/second * 1 byte/sample = 735 bytes.
		if (AudioBuffer.length == 735)
		{
			postMessage({ "Type": "Audio", "Data": AudioBuffer });
			AudioBuffer.length = 0;
			Running = false;
		}

		AudioSampleCycleCounter -= NES.CyclesPerAudioSample;
	}

	AdditionalCycles = 0;

	if (CurrentInterrupt != NES.InterruptType.None)
		HandleInterrupt();

	return CPU.PC();
};

var Running = false;
function Run()
{
	Running = true;
	while (Running)
	{
		Step();
	}
}

/*
Self.MemoryDump = function(Start, Length)
{
	var Memory = [];
	for (var i = 0; i < Length; i++)
		Memory.push(ReadByte(Start + i));

	return Memory;
};
*/

function ReadByte(Address)
{
	Address &= 0xFFFF;

	if (Address < 0x2000)
		return RAM[Address & 0x7FF];
	else if (Address < 0x4000)
		return PPU.ReadRegister(Address);
	else if (Address < 0x6000)
	{
		if (Address == 0x4015) return APU.ReadRegister(0x4015);
		if (Address == 0x4016)
		{
			var Value = Controllers[0].ButtonState[Controllers[0].Counter++];
			Controllers[0].Counter &= 7;
			return Value;
		}

		//throw "APU/input register read " + Address.toString(16).substr(-4, 4);
		return 0;
	}
	else if (Address < 0x8000)
		return Cartridge.Mapper().SRAM[Address & 0x1FFF];
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
		if (Address == 0x4016) return;
		APU.WriteRegister(Address, Value);
		//console.log("APU register write to " + Address.toString(16).substr(-4, 4));
		return;
	}
	else if (Address >= 0x6000 && Address < 0x8000)
		Cartridge.Mapper().SRAM[Address & 0x1FFF] = Value;
	else if (Address >= 0x8000)
		Cartridge.Mapper().WriteRegister(Address, Value);
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
