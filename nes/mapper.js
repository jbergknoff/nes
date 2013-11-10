var NES = NES || {};

// For now, just implementing mapper 0.
NES.Mapper = function(Number, ExternalPRG, ExternalCHR)
{
	this.Number = Number;

	// These variables will be what the outside world sees as "the" PRG and CHR.
	// They will actually be pointers to pages of the ExternalPRG and ExternalCHR.
	var PRG = new Array(4); // 4 exposed PRG pages.
	var CHR = new Array(8); // 8 exposed CHR pages.
	var WritableCHR = false;

	if (ExternalPRG.length < 2)
		throw "no PRG-ROM found";

	// Point the local mirrors of PRG to the first four pages of external PRG.
	PRG[0] = ExternalPRG[0];
	PRG[1] = ExternalPRG[1];
	PRG[2] = ExternalPRG[ExternalPRG.length - 2];
	PRG[3] = ExternalPRG[ExternalPRG.length - 1];

	// If there is no CHR-ROM, allocate ExternalCHR to be 8K of CHR-RAM.
	if (ExternalCHR.length == 0)
	{
		ExternalCHR = new Array(8);
		for (var i = 0; i < 8; i++)
			ExternalCHR[i] = new Uint8Array(NES.CHRPageSize);

		WritableCHR = true;
	}

	// Point the local mirrors of CHR to the first eight pages of external CHR.
	for (var i = 0; i < 8; i++)
		CHR[i] = ExternalCHR[i];




	this.ReadPRG = function(AbsoluteAddress)
	{
		return PRG[(AbsoluteAddress >> 13) & 3][AbsoluteAddress & 0x1FFF];
	}

	this.ReadCHR = function(AbsoluteAddress)
	{
		return CHR[(AbsoluteAddress >> 10) & 7][AbsoluteAddress & 0x03FF];
	}
}
