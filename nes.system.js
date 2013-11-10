var NES = NES || {};

// Callbacks: object with
//		DrawScreen: function() // TODO
//		PollInput: function() // TODO

// This is the class that connects all of the independent pieces of the system together:
// the CPU, PPU, APU, cartridge, etc.
NES.System = function(Callbacks)
{
	var ROM;

	// ROMData is a Uint8Array (https://developer.mozilla.org/en-US/docs/Web/API/ArrayBufferView)
	this.LoadROM = function(ROMData)
	{
		ROM = new NES.ROM(ROMData);
		if (ROM.IsValid()) console.log("rom looks fine");
		else console.log("rom not valid");
	}
};
