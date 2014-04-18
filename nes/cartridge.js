var NES = NES || {};

// Class for reading and parsing ROMs in iNES format.
/*
00h  File ID ('NES',1Ah)
04h  Number of 16K PRG-ROM pages
05h  Number of 8K CHR-ROM pages (00h=None / VRAM)
06h  Cartridge Type LSB
	Bit7-4  Mapper Number (lower 4bits)
	Bit3    1=Four-screen VRAM layout
	Bit2    1=512-byte trainer/patch at 7000h-71FFh
	Bit1    1=Battery-backed SRAM at 6000h-7FFFh, set only if battery-backed
	Bit0    0=Horizontal mirroring, 1=Vertical mirroring
07h  Cartridge Type MSB (ignore this and further bytes if Byte 0Fh nonzero)
	Bit7-4  Mapper Number (upper 4bits)
	Bit3-2  Reserved (zero)
	Bit1    1=PC10 game (arcade machine with additional 8K Z80-ROM) (*)
	Bit0    1=VS Unisystem game (arcade machine with different palette)
08h  Number of 8K RAM (SRAM?) pages (usually 00h=None-or-not-specified)
09h  Reserved (zero)
0Ah  Reserved (zero) (sometimes 03h,10h,13h,30h,33h purpose unknown) (*)
0Bh  Reserved (zero)
0Ch  Reserved (zero)
0Dh  Reserved (zero)
0Eh  Reserved (zero)
0Fh  Nonzero if [07h..0Fh]=GARBAGE, if so, assume [07h..0Fh]=ALL ZERO (*)
*/

NES.Cartridge = function(ROMData)
{
	var Self = this;

	var Valid = false;

	var PRGPageCount = 0;
	var CHRPageCount = 0;
	var Mirroring = NES.MirroringType.Horizontal;
	var SRAMEnabled = false;
	var Mapper;
	Self.MapperNumber = 0;

	Validate();

	function Validate()
	{
		// The first four bytes of a valid iNES file are 'N', 'E', 'S', 0x1A.
		// > btoa(String.fromCharCode.apply(null, (new Uint8Array([ 78, 69, 83, 26 ]))))
		// "TkVTGg=="
		if (btoa(String.fromCharCode.apply(null, ROMData.subarray(0, 4))) !== "TkVTGg==")
			return;

		PRGPageCount = 2 * ROMData[4];
		CHRPageCount = 8 * ROMData[5];
		console.log("PRGPageCount = " + PRGPageCount + ", CHRPageCount = " + CHRPageCount);

		var ExpectedLength = 0x10 + PRGPageCount * NES.PRGPageSize + CHRPageCount * NES.CHRPageSize;
		if (ROMData.length === 0x10 || ROMData.length !== ExpectedLength)
		{
			console.log("Expected length to be " + ExpectedLength.toString(16) + " but got " + ROMData.length.toString(16));
			return;
		}

		Mirroring = (ROMData[6] & 0x01) == 0 ? NES.MirroringType.Horizontal : NES.MirroringType.Vertical;
		SRAMEnabled = (ROMData[6] & 0x02) != 0;

		var PRGPages = [];
		var CHRPages = [];

		for (var i = 0; i < PRGPageCount; i++)
		{
			var Start = 0x10 + i * NES.PRGPageSize;
			PRGPages.push(ROMData.subarray(Start, Start + NES.PRGPageSize));
		}

		for (var i = 0; i < CHRPageCount; i++)
		{
			var Start = 0x10 + PRGPageCount * NES.PRGPageSize + i * NES.CHRPageSize;
			CHRPages.push(ROMData.subarray(Start, Start + NES.CHRPageSize));
		}

		Self.MapperNumber = ((ROMData[6] >> 4) & 0x0F) | (ROMData[7] & 0xF0);
		if (!NES.Mapper[Self.MapperNumber])
			throw "Mapper #" + Self.MapperNumber + " not supported";

		Mapper = new NES.Mapper[Self.MapperNumber](PRGPages, CHRPages);

		Valid = true;
	}

	// Accessors
	Self.IsValid = function() { return Valid; };
	Self.PRGPageCount = function() { return PRGPageCount; };
	Self.CHRPageCount = function() { return CHRPageCount; };
	Self.Mirroring = function() { return Mirroring; };
	Self.SRAMEnabled = function() { return SRAMEnabled; };
	Self.Mapper = function() { return Mapper; };
}
