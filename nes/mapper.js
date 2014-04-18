var NES = NES || {};
NES.Mapper = {};

NES.MapperBase = function(ExternalPRG, ExternalCHR)
{
	var Self = this;

	Self.ExternalPRG = ExternalPRG;
	Self.ExternalCHR = ExternalCHR;

	// Just allocate the SRAM. I don't really know how to determine if a game will use it or not.
	Self.SRAM = new Uint8Array(0x2000);

	// These variables will be what the outside world sees as "the" PRG and CHR.
	// They will actually be pointers to pages of the ExternalPRG and ExternalCHR.
	Self.PRG = new Array(4); // 4 exposed PRG pages.
	Self.CHR = new Array(8); // 8 exposed CHR pages.
	var WritableCHR = false;

	if (ExternalPRG.length < 2)
		throw "no PRG-ROM found";

	// Point the local mirrors of PRG to the first four pages of external PRG.
	Self.PRG[0] = Self.ExternalPRG[0];
	Self.PRG[1] = Self.ExternalPRG[1];
	Self.PRG[2] = Self.ExternalPRG[Self.ExternalPRG.length - 2];
	Self.PRG[3] = Self.ExternalPRG[Self.ExternalPRG.length - 1];

	// If there is no CHR-ROM, allocate ExternalCHR to be 8K of CHR-RAM.
	if (Self.ExternalCHR.length == 0)
	{
		Self.ExternalCHR = new Array(8);
		for (var i = 0; i < 8; i++)
			Self.ExternalCHR[i] = new Uint8Array(NES.CHRPageSize);

		WritableCHR = true;
	}

	// Point the local mirrors of CHR to the first eight pages of external CHR.
	for (var i = 0; i < 8; i++)
		Self.CHR[i] = Self.ExternalCHR[i];

	Self.ReadPRG = function(Address) { return Self.PRG[(Address >> 13) & 3][Address & 0x1FFF]; };
	Self.ReadCHR = function(Address) { return Self.CHR[(Address >> 10) & 7][Address & 0x03FF]; };

	Self.WriteCHR = function(Address, Value)
	{
		if (!WritableCHR) throw "can't write to CHR";
		Self.CHR[(Address >> 10) & 7][Address & 0x03FF] = Value;
	}
}

NES.Mapper[0] = function(ExternalPRG, ExternalCHR)
{
	var Self = this;
	NES.MapperBase.apply(Self, arguments);
}

NES.Mapper[1] = function(ExternalPRG, ExternalCHR)
{
	var Self = this;
	NES.MapperBase.apply(Self, arguments);

	// See http://wiki.nesdev.com/w/index.php/INES_Mapper_001.
	var Register0 = 0x0C; // Writes to any of 0x8000 - 0x9FFF
	var Register1 = 0; // Writes to any of 0xA000 - 0xBFFF
	var Register2 = 0; // Writes to any of 0xC000 - 0xDFFF
	var Register3 = 0; // Writes to any of 0xE000 - 0xFFFF
	var ShiftRegister = 0;
	var WriteCounter = 0;

	Self.Mirroring = NES.MirroringType.SingleScreen;

	// Returns true upon a successful five-write sequence which affected a register.
	Self.WriteRegister = function(Address, Value)
	{
		// If reset bit is set...
		if ((Value & 0x80) != 0)
		{
			ShiftRegister = 0;
			WriteCounter = 0;
			Register0 |= 0x0C;
			return;
		}

		// Write bits into ShiftRegister, LSB to MSB. First write is bit 0, fifth write is bit 4.
		ShiftRegister |= ((Value & 1) << WriteCounter++);
		if (WriteCounter != 5) return;

		WriteCounter = 0;
		switch (Address & 0xE000)
		{
			case 0x8000: // Register 0
				Register0 = ShiftRegister;
				UpdateCHR();
				UpdatePRG();

				switch (Register0 & 3)
				{
					case 2:
						Self.Mirroring = NES.MirroringType.Vertical;
						break;

					case 3:
						Self.Mirroring = NES.MirroringType.Horizontal;
						break;

					default:
						Self.Mirroring = NES.MirroringType.SingleScreen;
						break;
				}

				break;

			case 0xA000: // Register 1
				Register1 = ShiftRegister;
				UpdateCHR();
				break;

			case 0xC000: // Register 2
				Register2 = ShiftRegister;
				UpdateCHR();
				break;

			case 0xE000: // Register 3
				Register3 = ShiftRegister;
				UpdatePRG();
				break;
		}

		ShiftRegister = 0;
	};

	function UpdateCHR()
	{
		var CHRBankLower = 4 * (Register1 & 0x1F);
		var CHRBankUpper = 4 * (Register2 & 0x1F);

		// If 8K CHR mode and only 8K of CHR, ignore the registers.
		if ((Register0 & 0x10) == 0 && Self.ExternalCHR.length == 8)
			CHRBankLower = 0;

		if (CHRBankLower + 3 > Self.ExternalCHR.length)
			throw "Mapper 1 trying to access non-existent CHR bank " + CHRBankLower;

		// Point the first four pages to the CHR bank indicated by Register1.
		for (var i = 0; i < 4; i++)
			Self.CHR[i] = Self.ExternalCHR[CHRBankLower + i];

		// If we're in CHR 8k mode, also point the last four pages to Register1.
		if ((Register0 & 0x10) == 0)
		{
			if (CHRBankLower + 7 > Self.ExternalCHR.length)
				throw "Mapper 1 trying to access non-existent CHR bank " + CHRBankLower;

			for (var i = 4; i < 8; i++)
				Self.CHR[i] = Self.ExternalCHR[CHRBankLower + i];
		}
		else
		// If we're in CHR 4k mode, point the last four pages to the CHR bank indicated by Register2.
		{
			if (CHRBankUpper + 3 > Self.ExternalCHR.length)
				throw "Mapper 1 trying to access non-existent CHR bank " + CHRBankUpper;

			for (var i = 4; i < 8; i++)
				Self.CHR[i] = Self.ExternalCHR[CHRBankUpper + i - 4];
		}
	}

	function UpdatePRG()
	{
		/*
		Truth table for PRG. Bits belong to Register0.
		Multiplication by two because we break up PRG into 8 KB pages.

		Bit 3	Bit 2		PRG:	0x8000			0xC000
		----------------------------------------------------------
			0		0				2 * Reg3		2 * (Reg3 + 1)
			0		1				2 * Reg3		2 * (Reg3 + 1)
			1		0				0				2 * Reg3
			1		1				2 * Reg3		-1
		*/
		var PRGBankLower = 2 * (Register3 & 0x0F);
		if ((Register0 & 0x0C) == 0x08) PRGBankLower = 0;
		var PRGBankUpper = PRGBankLower + 2;
		if ((Register0 & 0x0C) == 0x08) PRGBankUpper = 2 * (Register3 & 0x0F);
		else if ((Register0 & 0x0C) == 0x0C) PRGBankUpper = Self.ExternalPRG.length - 2;

		if (PRGBankLower + 1 > Self.ExternalPRG.length || PRGBankUpper + 1 > Self.ExternalPRG.length)
			throw "Mapper 1 trying to access non-existent PRG bank";

		Self.PRG[0] = Self.ExternalPRG[PRGBankLower];
		Self.PRG[1] = Self.ExternalPRG[PRGBankLower + 1];
		Self.PRG[2] = Self.ExternalPRG[PRGBankUpper];
		Self.PRG[3] = Self.ExternalPRG[PRGBankUpper + 1];
	}
}
